import fs from 'node:fs/promises';
import path from 'node:path';
import { uuid } from '../lib/ids.js';
import { ApiError } from './assets-service.js';

export interface UploadSession {
  uploadId: string;
  originalName: string;
  expectedSize: number | null;
  tags: string[];
  folder: string;
  uploadedBy: string;
  createdAt: number;
  receivedParts: Set<number>;
  dir: string;
}

/** Resumable/chunked upload sessions (in-memory; temp parts persist on disk). */
export class UploadSessionManager {
  private sessions = new Map<string, UploadSession>();
  private chunkSize: number;

  constructor(private tmpRoot: string, chunkSize = 8 * 1024 * 1024, private ttlMs = 24 * 3600_000) {
    this.chunkSize = chunkSize;
    const sweeper = setInterval(() => this.sweep(), 10 * 60_000);
    sweeper.unref();
  }

  async create(opts: { originalName: string; expectedSize?: number; tags?: string[]; folder?: string; uploadedBy: string }): Promise<UploadSession> {
    const uploadId = uuid();
    const dir = path.join(this.tmpRoot, 'multipart', uploadId);
    await fs.mkdir(dir, { recursive: true });
    const session: UploadSession = {
      uploadId,
      originalName: opts.originalName,
      expectedSize: opts.expectedSize ?? null,
      tags: opts.tags ?? [],
      folder: opts.folder ?? '',
      uploadedBy: opts.uploadedBy,
      createdAt: Date.now(),
      receivedParts: new Set(),
      dir
    };
    this.sessions.set(uploadId, session);
    return session;
  }

  get(uploadId: string): UploadSession {
    const s = this.sessions.get(uploadId);
    if (!s) throw new ApiError(404, 'upload session not found or expired');
    return s;
  }

  partPath(session: UploadSession, index: number): string {
    return path.join(session.dir, `part-${String(index).padStart(6, '0')}`);
  }

  markPart(session: UploadSession, index: number): void { session.receivedParts.add(index); }

  sortedPartFiles(session: UploadSession): string[] {
    return [...session.receivedParts].sort((a, b) => a - b).map(i => this.partPath(session, i));
  }

  async destroy(uploadId: string): Promise<void> {
    const s = this.sessions.get(uploadId);
    this.sessions.delete(uploadId);
    if (s) await fs.rm(s.dir, { recursive: true, force: true }).catch(() => {});
  }

  private async sweep(): Promise<void> {
    const cutoff = Date.now() - this.ttlMs;
    for (const [id, s] of this.sessions) {
      if (s.createdAt < cutoff) await this.destroy(id);
    }
  }

  get defaultChunkSize(): number { return this.chunkSize; }
  get activeCount(): number { return this.sessions.size; }
}