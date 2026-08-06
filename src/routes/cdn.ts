import type { FastifyInstance } from 'fastify';
import path from 'node:path';
import zlib from 'node:zlib';
import { safeRelPath } from '../lib/sanitize.js';
import { COMPRESSIBLE } from '../storage/mime.js';

export function registerCdnRoutes(app: FastifyInstance): void {
  const ctx = app.mb;

  const handler = async (req: any, reply: any) => {
    const rel = safeRelPath(req.params['*']);
    if (!rel) return reply.code(400).send({ error: 'invalid path' });

    // Serve from storage — no metadata lookup required for delivery.
    const st = await ctx.adapter.stat(rel);
    if (!st) return reply.code(404).send({ error: 'not found' });

    const ext = path.extname(rel).slice(1).toLowerCase();
    const mime = ctx.layout.mimeFor(ext);
    const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;

    // 304 Not Modified
    const inm = req.headers['if-none-match'];
    if (typeof inm === 'string' && inm.split(',').map((s: string) => s.trim()).includes(etag)) {
      ctx.bus.emit('cdn.hit', { relPath: rel, notModified: true });
      return reply.code(304).header('ETag', etag).send();
    }

    reply
      .header('Cache-Control', `public, max-age=${ctx.config.cdnMaxAge}, immutable`)
      .header('ETag', etag)
      .header('Accept-Ranges', 'bytes')
      .header('Last-Modified', new Date(st.mtimeMs).toUTCString())
      .header('Content-Type', mime)
      .header('X-Content-Type-Options', 'nosniff');

    // Range requests (no compression when ranged)
    const range = req.headers.range;
    if (typeof range === 'string' && range.startsWith('bytes=')) {
      const spec = range.slice(6).split(',')[0].trim();
      const m = /^(\d*)-(\d*)$/.exec(spec);
      if (!m) return reply.code(416).header('Content-Range', `bytes */${st.size}`).send({ error: 'bad range' });
      let start = m[1] ? parseInt(m[1], 10) : NaN;
      let end = m[2] ? parseInt(m[2], 10) : NaN;
      if (Number.isNaN(start) && !Number.isNaN(end)) { start = Math.max(0, st.size - end); end = st.size - 1; } // suffix range
      if (Number.isNaN(end) || end >= st.size) end = st.size - 1;
      if (Number.isNaN(start) || start > end || start < 0) {
        return reply.code(416).header('Content-Range', `bytes */${st.size}`).send({ error: 'range not satisfiable' });
      }
      const stream = await ctx.adapter.createReadStream(rel, { start, end });
      ctx.bus.emit('cdn.hit', { relPath: rel, partial: true });
      return reply.code(206)
        .header('Content-Range', `bytes ${start}-${end}/${st.size}`)
        .header('Content-Length', end - start + 1)
        .send(stream);
    }

    const acceptEnc = String(req.headers['accept-encoding'] ?? '');
    const compress = COMPRESSIBLE(mime) && st.size < 10 * 1024 * 1024 && req.method === 'GET';
    const stream = await ctx.adapter.createReadStream(rel);
    ctx.bus.emit('cdn.hit', { relPath: rel });

    if (compress && acceptEnc.includes('br')) {
      reply.header('Content-Encoding', 'br').header('Vary', 'Accept-Encoding');
      return reply.send(stream.pipe(zlib.createBrotliCompress({ params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } })));
    }
    if (compress && acceptEnc.includes('gzip')) {
      reply.header('Content-Encoding', 'gzip').header('Vary', 'Accept-Encoding');
      return reply.send(stream.pipe(zlib.createGzip({ level: 6 })));
    }
    return reply.header('Content-Length', st.size).send(stream);
  };

  app.get('/cdn/*', handler);
  app.head('/cdn/*', handler);

  /** Thumbnails (public like CDN). */
  app.get('/thumbs/:file', async (req, reply) => {
    const file = String((req.params as any).file ?? '');
    if (!/^[0-9a-f-]{36}\.(webp|png|jpg)$/.test(file)) return reply.code(400).send({ error: 'invalid thumbnail' });
    try {
      const fs = await import('node:fs');
      const p = path.join(ctx.config.storageDir, 'thumbnails', file);
      return reply.header('Cache-Control', `public, max-age=${ctx.config.cdnMaxAge}`).send(fs.createReadStream(p));
    } catch {
      return reply.code(404).send({ error: 'thumbnail not found' });
    }
  });
}