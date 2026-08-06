import type { FastifyInstance } from 'fastify';
import { makeAuthenticate } from '../auth/authenticate.js';
import { sanitizeFolderName } from '../lib/sanitize.js';

export function registerMiscRoutes(app: FastifyInstance): void {
  const ctx = app.mb;
  const authenticate = makeAuthenticate(ctx);

  /** Folders (logical, metadata-only). */
  app.get('/api/v1/folders', { preHandler: authenticate('viewer') }, async () => {
    const derived = ctx.assets.aggregateFolders();
    const declared = ctx.folders.list();
    const byName = new Map(derived.map(f => [f.name, f]));
    for (const name of declared) if (!byName.has(name)) byName.set(name, { name, count: 0, bytes: 0 });
    return { folders: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)) };
  });

  app.post('/api/v1/folders', { preHandler: authenticate('editor') }, async (req, reply) => {
    const name = sanitizeFolderName(((req.body as any)?.name) ?? '');
    if (!name) return reply.code(400).send({ error: 'name required' });
    await ctx.folders.create(name);
    await ctx.activity.add(req.auth.username ?? ctx.assets.count() ? req.auth.subject : req.auth.subject, 'folder.create', name);
    return reply.code(201).send({ name });
  });

  app.patch('/api/v1/folders', { preHandler: authenticate('editor') }, async (req, reply) => {
    const { from, to } = (req.body ?? {}) as { from?: string; to?: string };
    const cleanTo = sanitizeFolderName(to ?? '');
    if (!from || !cleanTo) return reply.code(400).send({ error: 'from and to required' });
    await ctx.folders.rename(from, cleanTo);
    // Update all records in the folder (serialized mutation keeps index consistent)
    await ctx.assets.store.mutate(d => {
      for (const rec of Object.values(d.assets)) if (rec.folder === from) rec.folder = cleanTo;
    });
    ctx.bus.emit('folders.renamed', { from, to: cleanTo });
    return { ok: true };
  });

  app.delete('/api/v1/folders/:name', { preHandler: authenticate('editor') }, async (req, reply) => {
    const name = (req.params as any).name as string;
    const force = (req.query as any).force === '1';
    const agg = ctx.assets.aggregateFolders().find(f => f.name === name);
    if (agg && agg.count > 0 && !force) return reply.code(409).send({ error: 'folder not empty; use ?force=1 to move contents to root' });
    if (force) {
      await ctx.assets.store.mutate(d => {
        for (const rec of Object.values(d.assets)) if (rec.folder === name) rec.folder = '';
      });
    }
    await ctx.folders.remove(name);
    return { ok: true };
  });

  /** Tags aggregation. */
  app.get('/api/v1/tags', { preHandler: authenticate('viewer') }, async (req) => {
    const q = String((req.query as any)?.q ?? '').toLowerCase();
    let tags = ctx.assets.aggregateTags();
    if (q) tags = tags.filter(t => t.name.includes(q));
    return { tags };
  });

  /** Statistics. */
  app.get('/api/v1/statistics', { preHandler: authenticate('viewer') }, async () => ctx.stats.get());

  /** Activity log. */
  app.get('/api/v1/activity', { preHandler: authenticate('editor') }, async (req) => {
    const q = req.query as Record<string, string>;
    return ctx.activity.list({ page: Number(q.page) || 1, perPage: Number(q.perPage) || 50, action: q.action });
  });

  /** Runtime settings. */
  app.get('/api/v1/settings', { preHandler: authenticate('viewer') }, async () => ({
    settings: ctx.settings.get(),
    config: {
      dedupe: ctx.config.dedupe,
      namingStrategy: ctx.config.namingStrategy,
      thumbnailEnabled: ctx.config.thumbnailEnabled,
      maxFileSize: ctx.config.maxFileSize,
      maxChunkSize: ctx.config.maxChunkSize,
      cdnMaxAge: ctx.config.cdnMaxAge,
      s3Enabled: ctx.config.s3Enabled,
      s3Bucket: ctx.config.s3Bucket,
      version: (await import('../config.js')).VERSION
    },
    categories: ctx.layout.config
  }));

  app.put('/api/v1/settings', { preHandler: authenticate('admin') }, async (req, reply) => {
    const patch = (req.body ?? {}) as Record<string, unknown>;
    const saved = await ctx.settings.patch(patch);
    (await import('../config.js')).applyRuntimeSettings(ctx.config, saved);
    await ctx.activity.add(req.auth.username ?? req.auth.subject, 'settings.update', undefined, JSON.stringify(saved));
    ctx.bus.emit('settings.updated', saved);
    return reply.send({ settings: saved });
  });

  /** Explicit index rebuild (the only sanctioned filesystem scan). */
  app.post('/api/v1/rebuild-index', { preHandler: authenticate('admin') }, async (req) => {
    const rehash = (req.query as any)?.rehash === '1';
    const report = await ctx.service.rebuild(req.auth.username ?? req.auth.subject, rehash);
    return report;
  });

  /** Live update stream (Server-Sent Events). */
  app.get('/api/v1/events', { preHandler: authenticate('viewer') }, async (req, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    const send = (event: string, data: unknown) => {
      try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* closed */ }
    };
    send('hello', { ts: Date.now() });
    const off = ctx.bus.subscribeAll((type, payload) => {
      if (type === 'cdn.hit') return; // too noisy for the UI stream
      send(type, payload);
    });
    const hb = setInterval(() => { try { res.write(':hb\n\n'); } catch { /* ignore */ } }, 25_000);
    req.raw.on('close', () => { clearInterval(hb); off(); });
  });
}