import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { makeApp, login, uploadFile } from './helpers.js';

describe('concurrent upload integrity', () => {
  let app: FastifyInstance; let dir: string; let token: string;

  beforeAll(async () => { ({ app, dir } = await makeApp()); token = await login(app); });
  afterAll(async () => { await app.close(); });

  it('20 parallel uploads produce 20 consistent records and a valid assets.json', async () => {
    const N = 20;
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        uploadFile(app, token, `concurrent-${i}.txt`, Buffer.from(`payload-${i}-${Math.random()}`), 'text/plain'))
    );
    for (const r of results) expect(r.statusCode).toBe(201);

    const list = JSON.parse((await app.inject({
      method: 'GET', url: '/api/v1/assets?perPage=500', headers: { authorization: `Bearer ${token}` }
    })).payload);
    const concurrent = list.items.filter((r: any) => r.originalName.startsWith('concurrent-'));
    expect(concurrent.length).toBe(N);

    // all stored paths unique
    expect(new Set(concurrent.map((r: any) => r.relativePath)).size).toBe(N);

    // assets.json parses and matches in-memory count
    await app.close();
    const raw = JSON.parse(await fs.readFile(path.join(dir, 'metadata', 'assets.json'), 'utf8'));
    expect(Object.keys(raw.assets).length).toBeGreaterThanOrEqual(N);

    // restart: server reconstructs state purely from JSON indexes
    const { buildApp } = await import('../src/app.js');
    const app2 = await buildApp({
      storageDir: dir, publicDir: path.resolve('./public'), categoriesFile: path.resolve('./config/categories.json'),
      adminPassword: 'test-password-123', jwtSecret: 'test-secret', thumbnailEnabled: false, logLevel: 'silent' as never
    });
    const token2 = JSON.parse((await app2.inject({
      method: 'POST', url: '/api/v1/auth/login', headers: { 'content-type': 'application/json' },
      payload: { password: 'test-password-123' }
    })).payload).token;
    const list2 = JSON.parse((await app2.inject({
      method: 'GET', url: '/api/v1/assets?perPage=500', headers: { authorization: `Bearer ${token2}` }
    })).payload);
    expect(list2.items.filter((r: any) => r.originalName.startsWith('concurrent-')).length).toBe(N);
    await app2.close();
  });

  it('same filename uploaded concurrently never collides', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        uploadFile(app, token, 'race.txt', Buffer.from(`race-${Math.random()}`), 'text/plain'))
    );
    const stored = results.map(r => JSON.parse(r.payload).assets[0].storedName);
    expect(new Set(stored).size).toBe(8);
  });
});