import { JsonStore } from './json-store.js';
import type { StatsShape, AssetRecord } from '../types.js';

export function dayKeyUTC(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

const DAY_WINDOW = 90;

export class StatsEngine {
  constructor(private store: JsonStore<StatsShape>) {}

  private pruneDays(map: Record<string, number>): void {
    const cutoff = dayKeyUTC(new Date(Date.now() - DAY_WINDOW * 86400_000));
    for (const k of Object.keys(map)) if (k < cutoff) delete map[k];
  }

  get(): StatsShape & { todayUploads: number; downloadsToday: number } {
    const s = this.store.snapshot;
    return {
      ...s,
      todayUploads: s.uploadsByDay[dayKeyUTC()] ?? 0,
      downloadsToday: s.downloadsByDay[dayKeyUTC()] ?? 0
    };
  }

  async onUpload(rec: AssetRecord): Promise<void> {
    await this.store.mutate(s => {
      s.totalAssets += 1;
      s.totalBytes += rec.sizeBytes;
      s.byCategory[rec.category] = (s.byCategory[rec.category] ?? 0) + 1;
      if (rec.extension) s.byExtension[rec.extension] = (s.byExtension[rec.extension] ?? 0) + 1;
      const day = dayKeyUTC();
      s.uploadsByDay[day] = (s.uploadsByDay[day] ?? 0) + 1;
      this.pruneDays(s.uploadsByDay);
    });
  }

  async onDelete(rec: AssetRecord): Promise<void> {
    await this.store.mutate(s => {
      s.totalAssets = Math.max(0, s.totalAssets - 1);
      s.totalBytes = Math.max(0, s.totalBytes - rec.sizeBytes);
      if (s.byCategory[rec.category]) s.byCategory[rec.category] = Math.max(0, s.byCategory[rec.category] - 1);
      if (rec.extension && s.byExtension[rec.extension]) {
        s.byExtension[rec.extension] = Math.max(0, s.byExtension[rec.extension] - 1);
      }
    });
  }

  async onDownloads(n: number): Promise<void> {
    await this.store.mutate(s => {
      const day = dayKeyUTC();
      s.downloadsByDay[day] = (s.downloadsByDay[day] ?? 0) + n;
      this.pruneDays(s.downloadsByDay);
    });
  }

  async recompute(records: AssetRecord[]): Promise<void> {
    await this.store.mutate(s => {
      s.totalAssets = 0; s.totalBytes = 0;
      s.byCategory = {}; s.byExtension = {};
      for (const r of records) {
        s.totalAssets++; s.totalBytes += r.sizeBytes;
        s.byCategory[r.category] = (s.byCategory[r.category] ?? 0) + 1;
        if (r.extension) s.byExtension[r.extension] = (s.byExtension[r.extension] ?? 0) + 1;
      }
    });
  }

  async markRebuild(): Promise<void> {
    await this.store.mutate(s => { s.lastRebuildAt = new Date().toISOString(); });
  }
}