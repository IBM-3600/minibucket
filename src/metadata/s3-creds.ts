import crypto from 'node:crypto';
import { JsonStore } from './json-store.js';
import type { S3Credential } from '../types.js';

interface CredsFile { creds: Record<string, S3Credential>; }

/**
 * Dedicated SigV4 credentials for the optional S3 compatibility layer.
 * NOTE: secrets are stored at rest in plaintext in s3creds.json (SigV4
 * verification requires the server to know the secret). Protect STORAGE_DIR.
 */
export class S3CredsRepo {
  constructor(private store: JsonStore<CredsFile>) {}

  async create(label: string): Promise<S3Credential> {
    const cred: S3Credential = {
      accessKeyId: `MB${crypto.randomBytes(10).toString('hex').toUpperCase()}`,
      secretAccessKey: crypto.randomBytes(30).toString('base64url'),
      label,
      createdAt: new Date().toISOString()
    };
    await this.store.mutate(d => { d.creds[cred.accessKeyId] = cred; });
    return cred;
  }

  get(accessKeyId: string): S3Credential | undefined { return this.store.snapshot.creds[accessKeyId]; }

  list(): (Omit<S3Credential, 'secretAccessKey'>)[] {
    return Object.values(this.store.snapshot.creds).map(({ secretAccessKey: _s, ...rest }) => rest);
  }

  async remove(accessKeyId: string): Promise<boolean> {
    return this.store.mutate(d => {
      if (!d.creds[accessKeyId]) return false;
      delete d.creds[accessKeyId];
      return true;
    });
  }
}