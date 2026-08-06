import type { FastifyInstance } from 'fastify';
import { signJwt, verifyJwt } from '../lib/jwt.js';
import { makeAuthenticate } from '../auth/authenticate.js';

export function registerAuthRoutes(app: FastifyInstance): void {
  const ctx = app.mb;
  const authenticate = makeAuthenticate(ctx);

  app.post('/api/v1/auth/login', async (req, reply) => {
    const { username, password } = (req.body ?? {}) as { username?: string; password?: string };
    if (!password) return reply.code(400).send({ error: 'password required' });
    const user = ctx.users.verify(username || 'admin', password);
    if (!user) {
      await ctx.activity.add(username || 'anonymous', 'login.failed');
      return reply.code(401).send({ error: 'invalid credentials' });
    }
    await ctx.users.touchLogin(user.id);
    await ctx.activity.add(user.username, 'login');
    const accessToken = signJwt({ sub: user.id, username: user.username, role: user.role, type: 'access' }, ctx.config.jwtSecret, 3600);
    const refreshToken = signJwt({ sub: user.id, type: 'refresh' }, ctx.config.jwtSecret, 30 * 86400);
    return {
      token: accessToken,
      refreshToken,
      user: { id: user.id, username: user.username, role: user.role }
    };
  });

  app.post('/api/v1/auth/refresh', async (req, reply) => {
    const { refreshToken } = (req.body ?? {}) as { refreshToken?: string };
    if (!refreshToken) return reply.code(400).send({ error: 'refreshToken required' });
    const payload = verifyJwt<{ sub?: string; type?: string }>(refreshToken, ctx.config.jwtSecret);
    if (!payload || payload.type !== 'refresh' || !payload.sub) return reply.code(401).send({ error: 'invalid refresh token' });
    const user = ctx.users.get(payload.sub);
    if (!user) return reply.code(401).send({ error: 'user not found' });
    return { token: signJwt({ sub: user.id, username: user.username, role: user.role, type: 'access' }, ctx.config.jwtSecret, 3600) };
  });

  app.post('/api/v1/auth/logout', { preHandler: authenticate('viewer') }, async (req) => {
    await ctx.activity.add(req.auth.username ?? req.auth.subject, 'logout');
    return { ok: true };
  });

  app.get('/api/v1/users/me', { preHandler: authenticate('viewer') }, async (req) => {
    if (req.auth.kind === 'user' && req.auth.userId) {
      const u = ctx.users.get(req.auth.userId);
      if (u) return { id: u.id, username: u.username, role: u.role };
    }
    return { username: req.auth.username ?? 'api-key', role: req.auth.role, kind: req.auth.kind };
  });
}