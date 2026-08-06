import path from 'node:path';
import { writeJsonAtomic, readJsonSafe, restoreLatestBackup } from '../lib/atomic-json.js';
import type { Logger } from '../lib/logger.js';

export interface JsonStoreOptions<T> {
  file: string;
  backupDir: string;
  defaults: () => T;
  validate?: (raw: unknown) => T | null;
  logger?: Logger;
  flushDelayMs?: number;
}

/**
 * Serialized, crash-safe JSON document store.
 * - All mutations run through a single promise chain (serialized write queue).
 * - Writes are debounced, atomic (tmp+rename) with rolling backups.
 * - In-memory snapshot is the read path (no disk reads during normal operation).
 */
export class JsonStore<T> {
  private data!: T;
  private chain: Promise<unknown> = Promise.resolve();
  private flushTimer: NodeJS.Timeout | null = null;
  private dirty = false;
  private closed = false;

  constructor(private opts: JsonStoreOptions<T>) {}

  async init(): Promise<void> {
    const raw = await readJsonSafe<unknown>(this.opts.file);
    let loaded: T | null = null;
    if (raw !== null) loaded = this.opts.validate ? this.opts.validate(raw) : (raw as T);
    if (loaded === null && raw !== null) {
      this.opts.logger?.warn(`${path.basename(this.opts.file)} failed validation, trying backups`);
      const restored = await restoreLatestBackup(this.opts.file, this.opts.backupDir);
      if (restored !== null) loaded = this.opts.validate ? this.opts.validate(restored) : (restored as T);
    }
    if (loaded === null) {
      loaded = this.opts.defaults();
      this.data = loaded;
      this.dirty = true;
      await this.flush();
    } else {
      this.data = loaded;
    }
  }

  get snapshot(): T { return this.data; }

  /** Run a synchronous mutation under the serialized lock. */
  mutate<R>(fn: (data: T) => R): Promise<R> {
    if (this.closed) return Promise.reject(new Error('store closed'));
    const run = this.chain.then(() => {
      const result = fn(this.data);
      this.dirty = true;
      this.scheduleFlush();
      return result;
    });
    this.chain = run.catch(() => {});
    return run;
  }

  private scheduleFlush(): void {
    if (this.flushTimer || this.closed) return;
    this.flushTimer = setTimeout(() => { this.flushTimer = null; void this.flush(); }, this.opts.flushDelayMs ?? 250);
    this.flushTimer.unref?.();
  }

  async flush(): Promise<void> {
    if (!this.dirty) return;
    this.dirty = false;
    await writeJsonAtomic(this.opts.file, this.data, { backupDir: this.opts.backupDir });
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    await this.chain.catch(() => {});
    await this.flush();
  }
}