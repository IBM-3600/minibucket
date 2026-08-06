import type { Readable, Writable } from 'node:stream';

export interface TempHandle {
  path: string;
  stream: Writable;
  destroy(): Promise<void>;
}

export interface WalkEntry {
  relativePath: string; // relative to assets root, e.g. "images/png/foo.png"
  size: number;
  mtimeMs: number;
}

export interface StatResult { size: number; mtimeMs: number; }

/**
 * Storage backend abstraction. All metadata/logic code talks ONLY to this
 * interface, so S3/R2/GCS/Azure/B2 adapters can be swapped in without
 * touching the REST API or UI.
 */
export interface StorageAdapter {
  readonly kind: string;
  init(): Promise<void>;
  /** Open a writable temp file for streaming uploads. */
  tempFile(): Promise<TempHandle>;
  /** Move a finished temp file into the assets tree at relPath. Never overwrites. */
  moveIntoAssets(tmpPath: string, relPath: string): Promise<void>;
  createReadStream(relPath: string, opts?: { start?: number; end?: number }): Promise<Readable>;
  stat(relPath: string): Promise<StatResult | null>;
  exists(relPath: string): Promise<boolean>;
  deleteAsset(relPath: string): Promise<void>;
  /** Trash support (soft delete). */
  moveToTrash(relPath: string, trashName: string): Promise<void>;
  restoreFromTrash(trashName: string, relPath: string): Promise<void>;
  deleteTrashed(trashName: string): Promise<void>;
  /** Absolute path for local processing (thumbnails). May throw on non-local adapters. */
  resolveLocal(relPath: string): string;
  /** Full scan — ONLY used by the explicit rebuild-index operation. */
  walk(): AsyncGenerator<WalkEntry>;
}