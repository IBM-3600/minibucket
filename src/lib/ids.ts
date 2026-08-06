import crypto from 'node:crypto';
export const uuid = () => crypto.randomUUID();
export const shortHash = (s: string, len = 8) => crypto.createHash('sha256').update(s).digest('hex').slice(0, len);
export const randomToken = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url');