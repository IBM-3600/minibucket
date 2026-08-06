import type { AppContext } from '../types.js';

/**
 * Coalesces CDN hits into batched metadata updates (every 2s) so hot assets
 * don't cause per-request metadata writes. Serving itself never touches metadata.
 */
export class DownloadTracker {
  private pending = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private ctx: AppContext) {}

  hit(relPath: string): void {
    this.pending.set(relPath, (this.pending.get(relPath) ?? 0) + 1);
    if (!this.timer) {
      this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, 2000);
      this.timer.unref?.();
    }
  }

  async flush(): Promise<void> {
    if (this.pending.size === 0) return;
    const batch = this.pending;
    this.pending = new Map();
    let total = 0;
    for (const n of batch.values()) total += n;
    await this.ctx.assets.applyDownloadCounts(batch);
    await this.ctx.stats.onDownloads(total);
    this.ctx.bus.emit('stats.updated', { downloads: total });
  }
}