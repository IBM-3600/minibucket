import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pipeline, Readable } from 'node:stream';
import { Transform } from 'node:stream';
import { promisify } from 'node:util';
import type { Readable as ReadableType } from 'node:stream';
import { uuid } from '../lib/ids.js';
import { sanitizeFilename } from '../lib/sanitize.js';
import type { AppContext, AssetRecord, NamingStrategy } from '../types.js';

const pipelineP = promisify(pipeline);

export class ApiError extends Error {
  constructor(public statusCode: number, message: string) { super(message); }
}

export interface IngestOptions {
  stream: ReadableType;
  originalName: string;
  tags?: string[];
  folder?: string;
  source?: AssetRecord['source'];
  uploadedBy: string;
}

export interface FinalizeOptions {
  tmpPath: string;
  sha256: string;
  sizeBytes: number;
  originalName: string;
  tags?: string[];
  folder?: string;
  source?: AssetRecord['source'];
  uploadedBy: string;
}

export class AssetsService {
  constructor(private ctx: AppContext) {}

  /** Stream an upload to a temp file while computing SHA-256, then finalize. */
  async ingestStream(opts: IngestOptions): Promise<AssetRecord & { deduplicated?: boolean }> {
    const { config, adapter, layout } = this.ctx;
    const cleanName = sanitizeFilename(opts.originalName);
    const ext = path.extname(cleanName).slice(1).toLowerCase();
    const { allowed } = layout.classify(ext);
    if (!allowed) throw new ApiError(415, `file type ".${ext}" is not allowed`);

    const tmp = await adapter.tempFile();
    const hash = crypto.createHash('sha256');
    let size = 0;
    let limitExceeded = false;
    try {
      const meter = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          size += chunk.length;
          if (size > config.maxFileSize) { limitExceeded = true; cb(new ApiError(413, 'file exceeds MAX_FILE_SIZE')); return; }
          hash.update(chunk);
          cb(null, chunk);
        }
      });
      await pipelineP(opts.stream, meter, tmp.stream);
    } catch (err) {
      await tmp.destroy();
      throw err;
    }
    if (limitExceeded) { await tmp.destroy(); throw new ApiError(413, 'file exceeds MAX_FILE_SIZE'); }

    return this.finalize({
      tmpPath: tmp.path, sha256: hash.digest('hex'), sizeBytes: size,
      originalName: cleanName, tags: opts.tags, folder: opts.folder,
      source: opts.source ?? 'api', uploadedBy: opts.uploadedBy
    }).finally(() => { fs.unlink(tmp.path).catch(() => {}); });
  }

  /** Register a fully-written temp file as an asset (shared by simple + multipart uploads). */
  async finalize(opts: FinalizeOptions): Promise<AssetRecord & { deduplicated?: boolean }> {
    const { config, adapter, layout, assets, stats, activity, bus, queue } = this.ctx;

    // Deduplication
    if (config.dedupe) {
      const existing = assets.findBySha(opts.sha256);
      if (existing && !existing.deletedAt) {
        await fs.unlink(opts.tmpPath).catch(() => {});
        await activity.add(opts.uploadedBy, 'upload.deduplicated', existing.id, existing.originalName);
        return { ...existing, deduplicated: true };
      }
    }

    const ext = path.extname(opts.originalName).slice(1).toLowerCase();
    const category = layout.categoryFor(ext);
    const storedName = this.storedNameFor(opts.originalName, ext, opts.sha256, config.namingStrategy);
    const dir = ext ? `${category}/${ext}` : `${category}`;
    const relativePath = this.allocatePath(dir, storedName);

    await adapter.moveIntoAssets(opts.tmpPath, relativePath);

    const now = new Date().toISOString();
    const id = uuid();
    const record: AssetRecord = {
      id,
      originalName: opts.originalName,
      storedName: path.basename(relativePath),
      extension: ext,
      category,
      mimeType: layout.mimeFor(ext),
      sizeBytes: opts.sizeBytes,
      sha256: opts.sha256,
      etag: `"${opts.sha256}"`,
      relativePath,
      publicUrl: `/cdn/${relativePath}`,
      thumbnail: null,
      folder: opts.folder ?? '',
      source: opts.source ?? 'api',
      uploadedBy: opts.uploadedBy,
      uploadedAt: now,
      updatedAt: now,
      downloads: 0,
      lastAccess: null,
      cacheControl: `public,max-age=${config.cdnMaxAge}`,
      tags: opts.tags ?? [],
      versions: [],
      deletedAt: null
    };

    await assets.add(record);
    await stats.onUpload(record);
    await activity.add(opts.uploadedBy, 'upload', record.id, record.originalName);
    bus.emit('asset.created', record);
    if (config.thumbnailEnabled) queue.add('thumbnail', { id });
    return record;
  }

  private storedNameFor(originalName: string, ext: string, sha256: string, strategy: NamingStrategy): string {
    const base = originalName.replace(/\.[^.]*$/, '').slice(0, 120) || 'file';
    const suffix = ext ? `.${ext}` : '';
    switch (strategy) {
      case 'timestamp': {
        const d = new Date();
        const p = (n: number, l = 2) => String(n).padStart(l, '0');
        const stamp = `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
        return `${stamp}-${base}${suffix}`;
      }
      case 'uuid': return `${uuid()}${suffix}`;
      case 'hash':
      default: return `${base}-${sha256.slice(0, 8)}${suffix}`;
    }
  }

  /** Collision-safe path: never overwrites, appends -2, -3 ... if needed. */
  private allocatePath(dir: string, storedName: string): string {
    const { assets, layout } = this.ctx;
    let candidate = `${dir}/${storedName}`;
    if (!assets.pathTaken(candidate)) return candidate;
    const ext = path.extname(storedName);
    const stem = storedName.slice(0, storedName.length - ext.length);
    for (let i = 2; i < 1_000_000; i++) {
      candidate = `${dir}/${stem}-${i}${ext}`;
      if (!assets.pathTaken(candidate)) return candidate;
    }
    return `${dir}/${uuid()}${ext}`;
  }

  trashNameFor(rec: AssetRecord): string {
    return `${rec.id}-${rec.storedName}`;
  }

  async softDelete(id: string, actor: string): Promise<AssetRecord | null> {
    const { assets, adapter, stats, activity, bus } = this.ctx;
    const rec = assets.get(id);
    if (!rec || rec.deletedAt) return null;
    await adapter.moveToTrash(rec.relativePath, this.trashNameFor(rec));
    const updated = await assets.update(id, { deletedAt: new Date().toISOString() });
    await stats.onDelete(rec);
    await activity.add(actor, 'delete', id, rec.originalName);
    bus.emit('asset.deleted', { id });
    return updated;
  }

  async restore(id: string, actor: string): Promise<AssetRecord | null> {
    const { assets, adapter, stats, activity, bus } = this.ctx;
    const rec = assets.get(id);
    if (!rec || !rec.deletedAt) return null;
    // Re-allocate in case the path is now occupied.
    const dir = rec.extension ? `${rec.category}/${rec.extension}` : rec.category;
    let relPath = `${dir}/${rec.storedName}`;
    if (assets.pathTaken(relPath)) {
      const extSuffix = rec.extension ? `.${rec.extension}` : '';
      const stem = rec.storedName.slice(0, rec.storedName.length - extSuffix.length);
      for (let i = 2; ; i++) {
        relPath = `${dir}/${stem}-${i}${extSuffix}`;
        if (!assets.pathTaken(relPath)) break;
      }
    }
    await adapter.restoreFromTrash(this.trashNameFor(rec), relPath);
    const updated = await assets.update(id, { deletedAt: null, relativePath: relPath, storedName: path.basename(relPath), publicUrl: `/cdn/${relPath}` });
    await stats.onUpload(rec);
    await activity.add(actor, 'restore', id, rec.originalName);
    bus.emit('asset.restored', { id });
    return updated;
  }

  async purge(id: string, actor: string): Promise<AssetRecord | null> {
    const { assets, adapter, stats, activity, bus } = this.ctx;
    const rec = assets.get(id);
    if (!rec) return null;
    if (rec.deletedAt) await adapter.deleteTrashed(this.trashNameFor(rec));
    else { await adapter.deleteAsset(rec.relativePath); await stats.onDelete(rec); }
    await assets.remove(id);
    await activity.add(actor, 'purge', id, rec.originalName);
    bus.emit('asset.purged', { id });
    return rec;
  }

  /** Explicit rebuild from a filesystem scan — the ONLY sanctioned scan. */
  async rebuild(actor: string, rehash = false): Promise<{ scanned: number; kept: number; created: number; updated: number }> {
    const { adapter, assets, layout, stats, activity, bus } = this.ctx;
    const report = { scanned: 0, kept: 0, created: 0, updated: 0 };
    const records: AssetRecord[] = [];

    for await (const entry of adapter.walk()) {
      report.scanned++;
      const ext = path.extname(entry.relativePath).slice(1).toLowerCase();
      const category = layout.categoryFor(ext);
      const existing = assets.findByPath(entry.relativePath);

      if (existing && !existing.deletedAt && existing.sizeBytes === entry.size && !rehash) {
        records.push(existing);
        report.kept++;
        continue;
      }

      let sha256 = existing?.sha256;
      if (!sha256 || rehash || existing?.sizeBytes !== entry.size) {
        const hash = crypto.createHash('sha256');
        const rs = await adapter.createReadStream(entry.relativePath);
        for await (const chunk of rs) hash.update(chunk as Buffer);
        sha256 = hash.digest('hex');
      }

      const now = new Date().toISOString();
      const rec: AssetRecord = existing && !rehash ? { ...existing, sizeBytes: entry.size, updatedAt: now } : {
        id: existing?.id ?? uuid(),
        originalName: existing?.originalName ?? path.basename(entry.relativePath),
        storedName: path.basename(entry.relativePath),
        extension: ext,
        category,
        mimeType: layout.mimeFor(ext),
        sizeBytes: entry.size,
        sha256,
        etag: `"${sha256}"`,
        relativePath: entry.relativePath,
        publicUrl: `/cdn/${entry.relativePath}`,
        thumbnail: existing?.thumbnail ?? null,
        folder: existing?.folder ?? '',
        source: existing?.source ?? 'rebuild',
        uploadedBy: existing?.uploadedBy ?? 'rebuild',
        uploadedAt: existing?.uploadedAt ?? now,
        updatedAt: now,
        downloads: existing?.downloads ?? 0,
        lastAccess: existing?.lastAccess ?? null,
        cacheControl: existing?.cacheControl ?? `public,max-age=${this.ctx.config.cdnMaxAge}`,
        tags: existing?.tags ?? [],
        versions: existing?.versions ?? [],
        deletedAt: null
      };
      records.push(rec);
      existing ? report.updated++ : report.created++;
    }

    await assets.replaceAll(records);
    await stats.recompute(records);
    await stats.markRebuild();
    await activity.add(actor, 'rebuild-index', undefined, JSON.stringify(report));
    bus.emit('index.rebuilt', report);
    return report;
  }
}