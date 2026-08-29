import { JsonStore } from './json-store.js';
import type { AssetRecord, ListAssetsQuery } from '../types.js';
import type { Logger } from '../lib/logger.js';

interface AssetsFile { assets: Record<string, AssetRecord>; }

const REQUIRED_FIELDS: (keyof AssetRecord)[] =
  ['id', 'originalName', 'storedName', 'extension', 'category', 'mimeType', 'sizeBytes', 'sha256', 'relativePath', 'publicUrl', 'uploadedAt'];

export interface ListResult {
  items: AssetRecord[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

/**
 * Authoritative in-memory asset index backed by assets.json.
 * The UI / list / search APIs read ONLY from this index — never the filesystem.
 */
export class AssetsIndex {
  private byPath = new Map<string, string>();
  private bySha = new Map<string, string>();
  store: JsonStore<AssetsFile>;

  constructor(store: JsonStore<AssetsFile>, private logger?: Logger) {
    this.store = store;
  }

  /** Validate + build secondary maps after load. Invalid records are dropped and logged. */
  validateAndReindex(): { dropped: number } {
    let dropped = 0;
    const data = this.store.snapshot;
    for (const [id, rec] of Object.entries(data.assets)) {
      const valid = rec && typeof rec === 'object' &&
        REQUIRED_FIELDS.every(f => rec[f] !== undefined && rec[f] !== null) &&
        typeof rec.sizeBytes === 'number';
      if (!valid) { delete data.assets[id]; dropped++; continue; }
      this.indexOne(rec);
    }
    if (dropped > 0) this.logger?.warn(`assets index validation dropped ${dropped} invalid records`);
    return { dropped };
  }

  private indexOne(rec: AssetRecord): void {
    this.byPath.set(rec.relativePath, rec.id);
    if (!this.bySha.has(rec.sha256)) this.bySha.set(rec.sha256, rec.id);
  }
  private deindexOne(rec: AssetRecord): void {
    if (this.byPath.get(rec.relativePath) === rec.id) this.byPath.delete(rec.relativePath);
    if (this.bySha.get(rec.sha256) === rec.id) this.bySha.delete(rec.sha256);
  }

  get(id: string): AssetRecord | undefined { return this.store.snapshot.assets[id]; }
  findByPath(relPath: string): AssetRecord | undefined {
    const id = this.byPath.get(relPath);
    return id ? this.get(id) : undefined;
  }
  findBySha(sha256: string): AssetRecord | undefined {
    const id = this.bySha.get(sha256);
    return id ? this.get(id) : undefined;
  }
  findByPrefix(prefix: string): AssetRecord[] {
    return Object.values(this.store.snapshot.assets)
      .filter(r => !r.deletedAt && r.relativePath.startsWith(prefix))
      .sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  }
  count(includeTrashed = false): number {
    return Object.values(this.store.snapshot.assets).filter(r => includeTrashed || !r.deletedAt).length;
  }
  all(includeTrashed = false): AssetRecord[] {
    return Object.values(this.store.snapshot.assets).filter(r => includeTrashed || !r.deletedAt);
  }

  pathTaken(relPath: string): boolean { return this.byPath.has(relPath); }

  async add(rec: AssetRecord): Promise<void> {
    await this.store.mutate(d => { d.assets[rec.id] = rec; this.indexOne(rec); });
  }

  async update(id: string, patch: Partial<AssetRecord>): Promise<AssetRecord | null> {
    return this.store.mutate(d => {
      const rec = d.assets[id];
      if (!rec) return null;
      if (patch.relativePath && patch.relativePath !== rec.relativePath) this.deindexOne(rec);
      Object.assign(rec, patch, { updatedAt: new Date().toISOString() });
      if (patch.relativePath) this.indexOne(rec);
      return rec;
    });
  }

  async remove(id: string): Promise<AssetRecord | null> {
    return this.store.mutate(d => {
      const rec = d.assets[id];
      if (!rec) return null;
      this.deindexOne(rec);
      delete d.assets[id];
      return rec;
    });
  }

  /** Batch download counter updates from the CDN hit tracker (no per-request metadata writes). */
  async applyDownloadCounts(counts: Map<string, number>): Promise<void> {
    if (counts.size === 0) return;
    const now = new Date().toISOString();
    await this.store.mutate(d => {
      for (const [relPath, n] of counts) {
        const id = this.byPath.get(relPath);
        const rec = id ? d.assets[id] : undefined;
        if (rec) { rec.downloads += n; rec.lastAccess = now; }
      }
    });
  }

  /** Replace the entire index (used by rebuild-index). */
  async replaceAll(records: AssetRecord[]): Promise<void> {
    await this.store.mutate(d => {
      d.assets = {};
      this.byPath.clear();
      this.bySha.clear();
      for (const rec of records) { d.assets[rec.id] = rec; this.indexOne(rec); }
    });
  }

  list(q: ListAssetsQuery): ListResult {
    const page = Math.max(1, q.page ?? 1);
    const perPage = Math.min(500, Math.max(1, q.perPage ?? 50));
    const ql = q.q?.toLowerCase();
    const from = q.from ? Date.parse(q.from) : -Infinity;
    const to = q.to ? Date.parse(q.to) : Infinity;
    const minSize = q.minSize ?? -Infinity;
    const maxSize = q.maxSize ?? Infinity;

    let items = Object.values(this.store.snapshot.assets).filter(r => {
      if (q.trashed ? !r.deletedAt : !!r.deletedAt) return false;
      if (q.category && r.category !== q.category) return false;
      if (q.ext && r.extension !== q.ext.toLowerCase()) return false;
      if (q.mime && !r.mimeType.toLowerCase().includes(q.mime.toLowerCase())) return false;
      if (q.tag && !r.tags.some(t => t.toLowerCase() === q.tag!.toLowerCase())) return false;
      if (q.folder !== undefined && r.folder !== q.folder) return false;
      const ts = Date.parse(r.uploadedAt);
      if (ts < from || ts > to) return false;
      if (r.sizeBytes < minSize || r.sizeBytes > maxSize) return false;
      if (ql) {
        const hay = `${r.originalName} ${r.storedName} ${r.tags.join(' ')} ${r.folder} ${r.id}`.toLowerCase();
        if (!hay.includes(ql)) return false;
      }
      return true;
    });
    const sortKey = q.sort ?? 'uploadedAt';
    const dir = q.order === 'asc' ? 1 : -1;
    items.sort((a, b) => {
      const av = a[sortKey] as string | number;
      const bv = b[sortKey] as string | number;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
    
    const total = items.length;
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    items = items.slice((page - 1) * perPage, page * perPage);

    return { items, total, page, perPage, totalPages };
  }

  aggregateTags(): { name: string; count: number }[] {
    const counts = new Map<string, number>();
    for (const r of this.all()) for (const t of r.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts.entries()].map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }

  aggregateFolders(): { name: string; count: number; bytes: number }[] {
    const agg = new Map<string, { count: number; bytes: number }>();
    for (const r of this.all()) {
      const key = r.folder || '';
      const cur = agg.get(key) ?? { count: 0, bytes: 0 };
      cur.count++; cur.bytes += r.sizeBytes;
      agg.set(key, cur);
    }
    return [...agg.entries()].map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}