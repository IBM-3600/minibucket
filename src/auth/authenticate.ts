import type { FastifyReply, FastifyRequest } from 'fastify';
import { verifyJwt } from '../lib/jwt.js';
import { hasMinRole, scopeAllows } from './rbac.js';
import type { AppContext, AuthInfo, Role, Scope } from '../types.js';

interface JwtPayload { sub?: string; username?: string; role?: Role; type?: string; }

export function makeAuthenticate(ctx: AppContext) {
  return function authenticate(minRole: Role, opts: { scope?: Scope } = {}) {
    return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const auth = await resolveAuth(ctx, req);
      if (!auth) {
        void reply.code(401).header('WWW-Authenticate', 'Bearer').send({ error: 'authentication required' });
        return;
      }
      if (!ctx.limiter.allow(auth.subject, auth.kind === 'apikey' ? undefined : undefined)) {
        void reply.code(429).send({ error: 'rate limit exceeded' });
        return;
      }
      if (!hasMinRole(auth.role, minRole)) {
        void reply.code(403).send({ error: `requires role ${minRole}` });
        return;
      }
      if (opts.scope && auth.kind === 'apikey' && !scopeAllows(auth.scopes, opts.scope, auth.role)) {
        void reply.code(403).send({ error: `api key missing scope: ${opts.scope}` });
        return;
      }
      req.auth = auth;
    };
  };
}

async function resolveAuth(ctx: AppContext, req: FastifyRequest): Promise<AuthInfo | null> {
  const header = req.headers.authorization ?? '';
  const apiKeyHeader = req.headers['x-api-key'] as string | undefined;
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : null;
  const cookieToken = parseCookie(req.headers.cookie, 'mb_session');

  // 1) API keys
  const presentedKey = apiKeyHeader ?? (bearer?.startsWith('mbk_') ? bearer : null);
  if (presentedKey) {
    const rec = ctx.apiKeys.verify(presentedKey, req.ip);
    if (rec) {
      void ctx.apiKeys.touch(rec.id);
      return {
        kind: 'apikey', role: rec.role, keyId: rec.id, scopes: rec.scopes,
        subject: `key:${rec.id}`,
        username: `key:${rec.name}`
      };
    }
    return null;
  }

  // 2) JWT bearer / session cookie
  const token = bearer ?? cookieToken;
  if (token) {
    const payload = verifyJwt<JwtPayload>(token, ctx.config.jwtSecret);
    if (payload && payload.type !== 'refresh' && payload.sub) {
      const user = ctx.users.get(payload.sub);
      if (user) {
        return { kind: 'user', role: (payload.role as Role) ?? user.role, userId: user.id, username: user.username, subject: `user:${user.id}` };
      }
    }
  }
  return null;
}

function parseCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}