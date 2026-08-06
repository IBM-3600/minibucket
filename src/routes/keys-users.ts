import type { FastifyInstance } from 'fastify';
import { makeAuthenticate } from '../auth/authenticate.js';
import type { Role, Scope } from '../types.js';

const ROLES: Role[] = ['admin', 'editor', 'uploader', 'viewer'];
const SCOPES: Scope[] = ['read', 'write', 'delete', 'admin'];

export function registerAdminRoutes(app: FastifyInstance): void {
  const ctx = app.mb;
  const authenticate = makeAuthenticate(ctx);

  /** ── API keys ──────────────────────────────────────────────────────── */
  app.get('/api/v1/api-keys', { preHandler: authenticate('admin') }, async () => ({ keys: ctx.apiKeys.list() }));

  app.post('/api/v1/api-keys', { preHandler: authenticate('admin') }, async (req, reply) => {
    const b = (req.body ?? {}) as { name?: string; role?: Role; scopes?: Scope[]; expiresInDays?: number; rateLimitRpm?: number; ipAllowlist?: string[] };
    if (!b.name) return reply.code(400).send({ error: 'name required' });
    const role = ROLES.includes(b.role as Role) ? b.role! : 'uploader';
    const scopes = (b.scopes ?? []).filter(s => SCOPES.includes(s));
    const { plain, record } = await ctx.apiKeys.create({
      name: b.name, role, scopes,
      expiresInDays: b.expiresInDays, rateLimitRpm: b.rateLimitRpm, ipAllowlist: b.ipAllowlist
    });
    await ctx.activity.add(req.auth.username ?? 'admin', 'apikey.create', record.id, record.name);
    return reply.code(201).send({ key: plain, record: { ...record, keyHash: undefined } });
  });

  app.delete('/api/v1/api-keys/:id', { preHandler: authenticate('admin') }, async (req) => {
    await ctx.apiKeys.revoke((req.params as any).id);
    await ctx.activity.add(req.auth.username ?? 'admin', 'apikey.revoke', (req.params as any).id);
    return { ok: true };
  });

  /** ── Users ─────────────────────────────────────────────────────────── */
  app.get('/api/v1/users', { preHandler: authenticate('admin') }, async () => ({ users: ctx.users.list() }));

  app.post('/api/v1/users', { preHandler: authenticate('admin') }, async (req, reply) => {
    const b = (req.body ?? {}) as { username?: string; password?: string; role?: Role };
    if (!b.username || !b.password) return reply.code(400).send({ error: 'username and password required' });
    if (b.password.length < 8) return reply.code(400).send({ error: 'password must be at least 8 characters' });
    const role = ROLES.includes(b.role as Role) ? b.role! : 'viewer';
    try {
      const user = await ctx.users.create(b.username.trim().toLowerCase(), b.password, role);
      await ctx.activity.add(req.auth.username ?? 'admin', 'user.create', user.id, user.username);
      return reply.code(201).send({ id: user.id, username: user.username, role: user.role });
    } catch (err: any) {
      return reply.code(err.statusCode ?? 400).send({ error: err.message });
    }
  });

  app.patch('/api/v1/users/:id', { preHandler: authenticate('admin') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as { role?: Role; password?: string };
    const patch: { role?: Role; password?: string } = {};
    if (b.role && ROLES.includes(b.role)) patch.role = b.role;
    if (typeof b.password === 'string' && b.password.length >= 8) patch.password = b.password;
    const updated = await ctx.users.update(id, patch);
    if (!updated) return reply.code(404).send({ error: 'user not found' });
    return { id: updated.id, username: updated.username, role: updated.role };
  });

  app.delete('/api/v1/users/:id', { preHandler: authenticate('admin') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const target = ctx.users.get(id);
    if (!target) return reply.code(404).send({ error: 'user not found' });
    if (target.id === req.auth.userId) return reply.code(400).send({ error: 'cannot delete yourself' });
    if (target.role === 'admin' && ctx.users.adminCount() <= 1) {
      return reply.code(400).send({ error: 'cannot delete the last admin' });
    }
    await ctx.users.remove(id);
    await ctx.activity.add(req.auth.username ?? 'admin', 'user.delete', id, target.username);
    return { ok: true };
  });
}