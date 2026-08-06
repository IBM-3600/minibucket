import type { StorageAdapter, TempHandle, WalkEntry, StatResult } from './adapter.js';

/**
 * Blueprint for remote adapters (Amazon S3, Cloudflare R2, MinIO, Azure Blob,
 * GCS, Backblaze B2). Implement `StorageAdapter` against the provider SDK and
 * select it via STORAGE_DRIVER env. The REST API, CDN and UI are untouched —
 * only this boundary changes. Range requests map to `Range` on GetObject,
 * ETags to provider ETags, walk() to ListObjectsV2 paging.
 */
export class S3RemoteAdapter implements StorageAdapter {
  readonly kind = 's3-remote';
  constructor(private opts: { endpoint?: string; bucket: string; region: string; prefix?: string }) {}
  async init(): Promise<void> { throw new Error('S3RemoteAdapter not implemented — see README "Extending storage adapters"'); }
  async tempFile(): Promise<TempHandle> { throw new Error('not implemented'); }
  async moveIntoAssets(): Promise<void> { throw new Error('not implemented'); }
  async createReadStream(): Promise<never> { throw new Error('not implemented'); }
  async stat(): Promise<StatResult | null> { throw new Error('not implemented'); }
  async exists(): Promise<boolean> { throw new Error('not implemented'); }
  async deleteAsset(): Promise<void> { throw new Error('not implemented'); }
  async moveToTrash(): Promise<void> { throw new Error('not implemented'); }
  async restoreFromTrash(): Promise<void> { throw new Error('not implemented'); }
  async deleteTrashed(): Promise<void> { throw new Error('not implemented'); }
  resolveLocal(): string { throw new Error('remote adapter has no local path'); }
  async *walk(): AsyncGenerator<WalkEntry> { throw new Error('not implemented'); }
}