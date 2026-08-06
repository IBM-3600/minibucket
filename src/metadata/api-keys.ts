import crypto from 'node:crypto';
import { JsonStore } from './json-store.js';
import { uuid } from '../lib/ids.js';
import type { ApiKeyInfo, Role, Scope } from '../types.js';

interface KeysFile { keys: Record<string, ApiKeyInfo>; }

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export class ApiKeysRepo {
  constructor(private store: JsonStore<KeysFile>) {}

  async create(opts: {
    name: string; role: Role; scopes: Scope[]; expiresInDays?: number;
    rateLimitRpm?: number; ipAllowlist?: string[];
  }): Promise<{ plain: string; record: ApiKeyInfo }> {
    const plain = `mbk_${crypto.randomBytes(24).toString('base64url')}`;
    const record: ApiKeyInfo = {
      id: uuid(),
      name: opts.name,
      keyHash: sha(plain),
      prefix: plain.slice(0, 12),
      role: opts.role,
      scopes: opts.scopes?.length ? opts.scopes : ['read', 'write'],
      expiresAt: opts.expiresInDays ? new Date(Date.now() + opts.expiresInDays * 86400_000).toISOString() : null,
      rateLimitRpm: opts.rateLimitRpm ?? null,
      ipAllowlist: opts.ipAllowlist ?? [],
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      revoked: false
    };
    await this.store.mutate(d => { d.keys[record.id] = record; });
    return { plain, record };
  }

  /** Verify a presented key. Returns the record if valid for this ip/time. */
  verify(plain: string, ip?: string): ApiKeyInfo | null {
    const h = sha(plain);
    const rec = Object.values(this.store.snapshot.keys).find(k => k.keyHash === h);
    if (!rec || rec.revoked) return null;
    if (rec.expiresAt && Date.parse(rec.expiresAt) < Date.now()) return null;
    if (rec.ipAllowlist.length > 0 && ip && !rec.ipAllowlist.includes(ip)) return null;
    return rec;
  }

  list(): (Omit<ApiKeyInfo, 'keyHash'>)[] {
    return Object.values(this.store.snapshot.keys).map(({ keyHash: _kh, ...rest }) => rest);
  }

  async touch(id: string): Promise<void> {
    await this.store.mutate(d => { if (d.keys[id]) d.keys[id].lastUsedAt = new Date().toISOString(); });
  }

  async revoke(id: string): Promise<boolean> {
    return this.store.mutate(d => {
      if (!d.keys[id]) return false;
      d.keys[id].revoked = true;
      return true;
    });
  }
}