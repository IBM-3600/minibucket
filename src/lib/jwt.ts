import crypto from 'node:crypto';

const b64u = (s: string | Buffer) => Buffer.from(s).toString('base64url');

export function signJwt(payload: Record<string, unknown>, secret: string, expiresSec = 3600): string {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64u(JSON.stringify({ ...payload, iat: now, exp: now + expiresSec }));
  const sig = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${sig}`;
}

export function verifyJwt<T = Record<string, unknown>>(token: string, secret: string): T | null {
  try {
    const [h, p, s] = token.split('.');
    if (!h || !p || !s) return null;
    const expect = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
    const a = Buffer.from(s); const b = Buffer.from(expect);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8')) as Record<string, unknown> & { exp?: number };
    if (typeof payload.exp === 'number' && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload as T;
  } catch {
    return null;
  }
}