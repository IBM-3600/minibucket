import crypto from 'node:crypto';

export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 32, { N: 16384, r: 8, p: 1 }).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  try {
    const [scheme, salt, hash] = stored.split('$');
    if (scheme !== 'scrypt' || !salt || !hash) return false;
    const check = crypto.scryptSync(pw, salt, 32, { N: 16384, r: 8, p: 1 });
    const target = Buffer.from(hash, 'hex');
    return check.length === target.length && crypto.timingSafeEqual(check, target);
  } catch {
    return false;
  }
}