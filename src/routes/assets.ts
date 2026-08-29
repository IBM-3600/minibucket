import type { FastifyInstance } from 'fastify';
import { makeAuthenticate } from '../auth/authenticate.js';
import type { ListAssetsQuery } from '../types.js';


function parseListQuery(qs: Record<string, unknown>): ListAssetsQuery {
  const num = (v: unknown) => (v === undefined || v === '' ? undefined : Number(v));
  return {
    q: qs.q as string | undefined,
    category: qs.category as string | undefined,
    tag: qs.tag as string | undefined,
    mime: qs.mime as string | undefined,
    ext: qs.ext as string | undefined,
    folder: qs.folder as string | undefined,
    from: qs.from as string | undefined,
    to: qs.to as string | undefined,
    minSize: num(qs.minSize),
    maxSize: num(qs.maxSize),
    sort: (qs.sort as ListAssetsQuery['sort']) ?? 'uploadedAt',
    order: qs.order === 'asc' ? 'asc' : 'desc',
    page: num((qs.page as unknown[])?.[0]) ?? 1,
    perPage: num(qs.perPage) ?? 50,
    trashed: qs.trashed === 'true' || qs.trashed === '1'
  };
}

export function registerAssetRoutes(app: FastifyInstance): void {
  const ctx = app.mb;
  const authenticate = makeAuthenticate(ctx);

  app.get('/api/v1/assets', { preHandler: authenticate('viewer') }, async (req) => {
    const list = ctx.assets.list(parseListQuery(req.query as Record<string, unknown>));
    return list;
  });

  app.get('/api/v1/search', { preHandler: authenticate('viewer') }, async (req) => {
    return ctx.assets.list(parseListQuery(req.query as Record<string, unknown>));
  });

  app.get('/api/v1/assets/:id', { preHandler: authenticate('viewer') }, async (req, reply) => {
    const rec = ctx.assets.get((req.params as { id: string }).id);
    if (!rec) return reply.code(404).send({ error: 'asset not found' });
    return rec;
  });

  app.get('/api/v1/assets/:id/download', { preHandler: authenticate('viewer') }, async (req, reply) => {
    const rec = ctx.assets.get((req.params as { id: string }).id);
    if (!rec || rec.deletedAt) return reply.code(404).send({ error: 'asset not found' });
    return reply.redirect(rec.publicUrl);
  });

  app.patch('/api/v1/assets/:id', { preHandler: authenticate('editor') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { originalName?: string; tags?: string[]; cacheControl?: string; folder?: string };
    const rec = ctx.assets.get(id);
    if (!rec || rec.deletedAt) return reply.code(404).send({ error: 'asset not found' });
    const patch: Record<string, unknown> = {};
    if (typeof body.originalName === 'string' && body.originalName.trim()) patch.originalName = body.originalName.trim().slice(0, 180);
    if (Array.isArray(body.tags)) patch.tags = body.tags.map(t => String(t).trim().toLowerCase()).filter(Boolean).slice(0, 50);
    if (typeof body.cacheControl === 'string') patch.cacheControl = body.cacheControl.slice(0, 200);
    if (typeof body.folder === 'string') patch.folder = body.folder.slice(0, 100);
    const updated = await ctx.assets.update(id, patch);
    await ctx.activity.add(req.auth.username ?? req.auth.subject, 'metadata.update', id, JSON.stringify(Object.keys(patch)));
    ctx.bus.emit('asset.updated', updated);
    return updated;
  });

  app.delete('/api/v1/assets/:id', { preHandler: authenticate('editor') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const qs = req.query as { purge?: string };
    const actor = req.auth.username ?? req.auth.subject;
    const rec = qs.purge === '1' || qs.purge === 'true'
      ? (ctx.assets.get(id)?.deletedAt ? await ctx.service.purge(id, actor) : reply.code(400).send({ error: 'asset not in trash; move to trash first' }) as never)
      : await ctx.service.softDelete(id, actor);
    if (!rec) return reply.code(404).send({ error: 'asset not found' });
    return reply.code(200).send(rec);
  });

  app.post('/api/v1/assets/:id/restore', { preHandler: authenticate('editor') }, async (req, reply) => {
    const rec = await ctx.service.restore((req.params as { id: string }).id, req.auth.username ?? req.auth.subject);
    if (!rec) return reply.code(404).send({ error: 'asset not in trash' });
    return rec;
  });

  app.post('/api/v1/assets/bulk', { preHandler: authenticate('editor') }, async (req, reply) => {
    const body = (req.body ?? {}) as { action?: string; ids?: string[]; tags?: string[]; folder?: string };
    const ids = Array.isArray(body.ids) ? body.ids.slice(0, 1000) : [];
    if (ids.length === 0 || !body.action) return reply.code(400).send({ error: 'action and ids required' });
    const actor = req.auth.username ?? req.auth.subject;
    let ok = 0; let failed = 0;
    for (const id of ids) {
      try {
        switch (body.action) {
          case 'delete': if (await ctx.service.softDelete(id, actor)) ok++; else failed++; break;
          case 'restore': if (await ctx.service.restore(id, actor)) ok++; else failed++; break;
          case 'purge': if (await ctx.service.purge(id, actor)) ok++; else failed++; break;
          case 'addTags': {
            const rec = ctx.assets.get(id);
            if (rec) { await ctx.assets.update(id, { tags: [...new Set([...rec.tags, ...(body.tags ?? [])])] }); ok++; } else failed++;
            break;
          }
          case 'removeTags': {
            const rec = ctx.assets.get(id);
            if (rec) { await ctx.assets.update(id, { tags: rec.tags.filter(t => !(body.tags ?? []).includes(t)) }); ok++; } else failed++;
            break;
          }
          case 'move': {
            if (typeof body.folder !== 'string') throw new Error('folder required');
            if (await ctx.assets.update(id, { folder: body.folder })) ok++; else failed++;
            break;
          }
          default: return reply.code(400).send({ error: `unknown action ${body.action}` });
        }
      } catch { failed++; }
    }
    ctx.bus.emit('assets.bulk', { action: body.action, ok, failed });
    return { ok, failed };
  });
}