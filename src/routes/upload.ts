import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import crypto from 'node:crypto';
import { once } from 'node:events';
import { makeAuthenticate } from '../auth/authenticate.js';
import { ApiError } from '../services/assets-service.js';

function fieldValues(part: any, name: string): string[] {
  const f = part?.fields?.[name];
  if (!f) return [];
  return String(f.value ?? '').split(',').map((s: string) => s.trim()).filter(Boolean);
}
function fieldValue(part: any, name: string): string | undefined {
  const f = part?.fields?.[name];
  return f ? String(f.value ?? '') : undefined;
}

export function registerUploadRoutes(app: FastifyInstance): void {
  const ctx = app.mb;
  const authenticate = makeAuthenticate(ctx);

  /** Streaming multipart upload (one or many files per request). */
  app.post('/api/v1/assets', { preHandler: authenticate('uploader', { scope: 'write' }) }, async (req, reply) => {
    const actor = req.auth.username ?? req.auth.subject;
    const created: unknown[] = [];
    try {
      for await (const part of (req as any).parts()) {
        if (part.type !== 'file') continue;
        const rec = await ctx.service.ingestStream({
          stream: part.file,
          originalName: part.filename || 'upload.bin',
          tags: fieldValues(part, 'tags'),
          folder: fieldValue(part, 'folder'),
          source: fieldValue(part, 'source') === 'ui' ? 'ui' : 'api',
          uploadedBy: actor
        });
        created.push(rec);
      }
    } catch (err) {
      if (err instanceof ApiError) return reply.code(err.statusCode).send({ error: err.message });
      const e = err as { statusCode?: number; message?: string };
      if (e?.statusCode) return reply.code(e.statusCode).send({ error: e.message });
      req.log.error(err);
      return reply.code(500).send({ error: 'upload failed' });
    }
    return reply.code(201).send({ assets: created, count: created.length });
  });

  /** ── Resumable multipart sessions ─────────────────────────────────── */

  app.post('/api/v1/assets/multipart', { preHandler: authenticate('uploader', { scope: 'write' }) }, async (req, reply) => {
    const body = (req.body ?? {}) as { filename?: string; size?: number; tags?: string[]; folder?: string };
    if (!body.filename) return reply.code(400).send({ error: 'filename required' });
    const session = await ctx.uploads.create({
      originalName: body.filename,
      expectedSize: body.size,
      tags: body.tags,
      folder: body.folder,
      uploadedBy: req.auth.username ?? req.auth.subject
    });
    return reply.code(201).send({
      uploadId: session.uploadId,
      chunkSize: ctx.uploads.defaultChunkSize,
      expiresAt: new Date(session.createdAt + 24 * 3600_000).toISOString()
    });
  });

  app.get('/api/v1/assets/multipart/:uploadId', { preHandler: authenticate('uploader') }, async (req) => {
    const s = ctx.uploads.get((req.params as any).uploadId);
    return {
      uploadId: s.uploadId,
      originalName: s.originalName,
      expectedSize: s.expectedSize,
      receivedParts: [...s.receivedParts].sort((a, b) => a - b),
      chunkSize: ctx.uploads.defaultChunkSize
    };
  });

  app.put('/api/v1/assets/multipart/:uploadId/chunk/:index',
    { preHandler: authenticate('uploader', { scope: 'write' }) },
    async (req, reply) => {
      const { uploadId, index } = req.params as { uploadId: string; index: string };
      const partIndex = Number(index);
      if (!Number.isInteger(partIndex) || partIndex < 0) return reply.code(400).send({ error: 'invalid chunk index' });
      const contentLength = Number(req.headers['content-length'] ?? 0);
      if (contentLength > ctx.config.maxChunkSize) return reply.code(413).send({ error: 'chunk exceeds MAX_CHUNK_SIZE' });

      const session = ctx.uploads.get(uploadId);
      const dest = ctx.uploads.partPath(session, partIndex);
      const hash = crypto.createHash('sha256');
      let size = 0;
      const out = fs.createWriteStream(dest);
      try {
        for await (const chunk of req.body as AsyncIterable<Buffer>) {
          size += chunk.length;
          if (size > ctx.config.maxChunkSize) { out.destroy(); await fsp.unlink(dest).catch(() => {}); return reply.code(413).send({ error: 'chunk exceeds MAX_CHUNK_SIZE' }); }
          hash.update(chunk);
          if (!out.write(chunk)) await once(out, 'drain');
        }
        out.end();
        await once(out, 'finish');
      } catch (err) {
        out.destroy();
        await fsp.unlink(dest).catch(() => {});
        throw err;
      }
      ctx.uploads.markPart(session, partIndex);
      return { index: partIndex, receivedBytes: size, partSha256: hash.digest('hex'), totalReceived: session.receivedParts.size };
    });

  app.post('/api/v1/assets/multipart/:uploadId/complete',
    { preHandler: authenticate('uploader', { scope: 'write' }) },
    async (req, reply) => {
      const { uploadId } = req.params as { uploadId: string };
      const session = ctx.uploads.get(uploadId);
      const body = (req.body ?? {}) as { tags?: string[]; folder?: string };
      const parts = [...session.receivedParts].sort((a, b) => a - b);
      if (parts.length === 0) return reply.code(400).send({ error: 'no parts uploaded' });
      for (let i = 0; i < parts.length; i++) {
        if (parts[i] !== i) return reply.code(400).send({ error: `missing chunk ${i}` });
      }

      // Assemble parts into one temp file while hashing.
      const tmp = await ctx.adapter.tempFile();
      const hash = crypto.createHash('sha256');
      let size = 0;
      try {
        for (const file of ctx.uploads.sortedPartFiles(session)) {
          const rs = fs.createReadStream(file);
          for await (const chunk of rs) {
            size += chunk.length;
            if (size > ctx.config.maxFileSize) throw new ApiError(413, 'file exceeds MAX_FILE_SIZE');
            hash.update(chunk as Buffer);
            if (!(tmp.stream as fs.WriteStream).write(chunk)) await once(tmp.stream, 'drain');
          }
        }
        (tmp.stream as fs.WriteStream).end();
        await once(tmp.stream, 'finish');
      } catch (err) {
        (tmp.stream as fs.WriteStream).destroy();
        await tmp.destroy();
        if (err instanceof ApiError) return reply.code(err.statusCode).send({ error: err.message });
        throw err;
      }

      try {
        const rec = await ctx.service.finalize({
          tmpPath: tmp.path,
          sha256: hash.digest('hex'),
          sizeBytes: size,
          originalName: session.originalName,
          tags: body.tags?.length ? body.tags : session.tags,
          folder: body.folder ?? session.folder,
          source: 'api',
          uploadedBy: session.uploadedBy
        });
        await ctx.uploads.destroy(uploadId);
        return reply.code(201).send(rec);
      } catch (err) {
        if (err instanceof ApiError) return reply.code(err.statusCode).send({ error: err.message });
        throw err;
      }
    });

  app.delete('/api/v1/assets/multipart/:uploadId', { preHandler: authenticate('uploader') }, async (req) => {
    await ctx.uploads.destroy((req.params as any).uploadId);
    return { ok: true };
  });
}