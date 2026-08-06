import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { AppContext } from '../types.js';

let sharpModule: any | null | undefined; // undefined = unresolved
async function trySharp(): Promise<any | null> {
  if (sharpModule !== undefined) return sharpModule;
  try { sharpModule = (await import('sharp')).default; }
  catch { sharpModule = null; }
  return sharpModule;
}

let ffmpegAvailable: boolean | undefined;
function hasFfmpeg(): boolean {
  if (ffmpegAvailable === undefined) {
    try { ffmpegAvailable = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0; }
    catch { ffmpegAvailable = false; }
  }
  return ffmpegAvailable;
}

/** Register background thumbnail/preview jobs. */
export function registerThumbnailJobs(ctx: AppContext): void {
  const thumbsDir = path.join(ctx.config.storageDir, 'thumbnails');

  ctx.queue.register('thumbnail', async ({ id }: { id: string }) => {
    const rec = ctx.assets.get(id);
    if (!rec || rec.deletedAt) return;
    await fs.mkdir(thumbsDir, { recursive: true });
    const out = path.join(thumbsDir, `${rec.id}.webp`);

    try {
      if (rec.category === 'images' && rec.extension !== 'svg') {
        const sharp = await trySharp();
        if (!sharp) return; // sharp not installed → skip silently
        const src = ctx.adapter.resolveLocal(rec.relativePath);
        await sharp(src, { animated: false }).rotate().resize(480, 480, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 78 }).toFile(out);
      } else if (rec.extension === 'svg') {
        const sharp = await trySharp();
        if (!sharp) return;
        const src = ctx.adapter.resolveLocal(rec.relativePath);
        await sharp(src, { density: 96 }).resize(480, 480, { fit: 'inside' }).webp({ quality: 82 }).toFile(out);
      } else if (rec.category === 'videos' && hasFfmpeg()) {
        const src = ctx.adapter.resolveLocal(rec.relativePath);
        const r = spawnSync('ffmpeg', ['-y', '-ss', '1', '-i', src, '-frames:v', '1', '-vf', 'scale=480:-2', out],
          { stdio: 'ignore', timeout: 30_000 });
        if (r.status !== 0) return;
      } else {
        return; // no preview pipeline for this type (pdf/hdr/models hooks live here)
      }

      await ctx.assets.update(id, { thumbnail: `/thumbs/${rec.id}.webp` });
      ctx.bus.emit('asset.thumbnail', { id });
    } catch (err) {
      ctx.bus.emit('asset.thumbnail-failed', { id, error: (err as Error).message });
    }
  });
}