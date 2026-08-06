import fs from 'node:fs/promises';
import fssync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import type { StorageAdapter, TempHandle, WalkEntry, StatResult } from './adapter.js';
import type { Layout } from './layout.js';

/** Local filesystem storage adapter. Assets live under <root>/assets/<category>/<ext>/. */
export class FsStorageAdapter implements StorageAdapter {
  readonly kind = 'fs';
  private assetsDir: string;
  private tmpDir: string;
  private trashDir: string;

  constructor(private rootDir: string, private layout: Layout) {
    this.assetsDir = path.join(rootDir, 'assets');
    this.tmpDir = path.join(rootDir, 'tmp');
    this.trashDir = path.join(rootDir, 'trash');
  }

  get assetsRoot(): string { return this.assetsDir; }
  get trashRoot(): string { return this.trashDir; }

  async init(): Promise<void> {
    await fs.mkdir(this.tmpDir, { recursive: true });
    await fs.mkdir(this.trashDir, { recursive: true });
    // Pre-create the full category/extension tree from the layout config.
    for (const [cat, def] of Object.entries(this.layout.config.categories)) {
      for (const ext of def.extensions) {
        await fs.mkdir(path.join(this.assetsDir, cat, ext), { recursive: true });
      }
    }
    await fs.mkdir(path.join(this.assetsDir, 'other'), { recursive: true });
  }

  private guard(relPath: string): string {
    const abs = path.resolve(this.assetsDir, relPath);
    if (!abs.startsWith(this.assetsDir + path.sep) && abs !== this.assetsDir) {
      throw new Error(`path traversal blocked: ${relPath}`);
    }
    return abs;
  }

  async tempFile(): Promise<TempHandle> {
    const name = `upload-${Date.now()}-${crypto.randomBytes(8).toString('hex')}.part`;
    const p = path.join(this.tmpDir, name);
    return {
      path: p,
      stream: fssync.createWriteStream(p),
      destroy: async () => { await fs.unlink(p).catch(() => {}); }
    };
  }

  async moveIntoAssets(tmpPath: string, relPath: string): Promise<void> {
    const dest = this.guard(relPath);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    try {
      await fs.rename(tmpPath, dest);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
        await fs.copyFile(tmpPath, dest);
        await fs.unlink(tmpPath).catch(() => {});
      } else throw err;
    }
  }

  async createReadStream(relPath: string, opts?: { start?: number; end?: number }): Promise<ReturnType<typeof createReadStream>> {
    const abs = this.guard(relPath);
    return createReadStream(abs, opts ? { start: opts.start, end: opts.end } : undefined);
  }

  async stat(relPath: string): Promise<StatResult | null> {
    try {
      const st = await fs.stat(this.guard(relPath));
      return { size: st.size, mtimeMs: st.mtimeMs };
    } catch { return null; }
  }

  async exists(relPath: string): Promise<boolean> {
    return fs.access(this.guard(relPath)).then(() => true, () => false);
  }

  async deleteAsset(relPath: string): Promise<void> {
    await fs.unlink(this.guard(relPath)).catch(() => {});
  }

  async moveToTrash(relPath: string, trashName: string): Promise<void> {
    const src = this.guard(relPath);
    const dest = path.join(this.trashDir, trashName);
    await fs.mkdir(this.trashDir, { recursive: true });
    try { await fs.rename(src, dest); }
    catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
        await fs.copyFile(src, dest); await fs.unlink(src).catch(() => {});
      } else throw err;
    }
  }

  async restoreFromTrash(trashName: string, relPath: string): Promise<void> {
    const src = path.join(this.trashDir, trashName);
    const dest = this.guard(relPath);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    try { await fs.rename(src, dest); }
    catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
        await fs.copyFile(src, dest); await fs.unlink(src).catch(() => {});
      } else throw err;
    }
  }

  async deleteTrashed(trashName: string): Promise<void> {
    await fs.unlink(path.join(this.trashDir, trashName)).catch(() => {});
  }

  resolveLocal(relPath: string): string { return this.guard(relPath); }

  async *walk(): AsyncGenerator<WalkEntry> {
    const stack: string[] = [this.assetsDir];
    while (stack.length > 0) {
      const dir = stack.pop()!;
      let entries: import('node:fs').Dirent[] = [];
      try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        const abs = path.join(dir, e.name);
        if (e.isDirectory()) stack.push(abs);
        else if (e.isFile()) {
          const st = await fs.stat(abs).catch(() => null);
          if (!st) continue;
          yield {
            relativePath: path.relative(this.assetsDir, abs).split(path.sep).join('/'),
            size: st.size,
            mtimeMs: st.mtimeMs
          };
        }
      }
    }
  }
}