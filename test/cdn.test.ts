import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeApp, login, uploadFile } from './helpers.js';

let app: FastifyInstance; let token: string; let rec: any;

beforeAll(async () => {
  ({ app } = await makeApp());
  token = await login(app);
  const data = Buffer.from('A'.repeat(10_000));
  const res = await uploadFile(app, token, 'range-test.txt', data, 'text/plain');
  rec = JSON.parse(res.payload).assets[0];
});
afterAll(async () => { await app.close(); });

describe('CDN delivery', () => {
  it('serves with immutable cache headers + ETag + Last-Modified', async () => {
    const res = await app.inject({ method: 'GET', url: rec.publicUrl });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toMatch(/public, max-age=\d+, immutable/);
    expect(res.headers.etag).toBeTruthy();
    expect(res.headers['last-modified']).toBeTruthy();
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.headers['content-type']).toContain('text/plain');
  });

  it('returns 304 for If-None-Match', async () => {
    const first = await app.inject({ method: 'GET', url: rec.publicUrl });
    const etag = first.headers.etag as string;
    const res = await app.inject({ method: 'GET', url: rec.publicUrl, headers: { 'if-none-match': etag } });
    expect(res.statusCode).toBe(304);
  });

  it('supports HTTP Range (206 partial content)', async () => {
    const res = await app.inject({ method: 'GET', url: rec.publicUrl, headers: { range: 'bytes=0-99' } });
    expect(res.statusCode).toBe(206);
    expect(res.headers['content-range']).toBe(`bytes 0-99/${rec.sizeBytes}`);
    expect(res.rawPayload.length).toBe(100);
  });

  it('returns 416 for unsatisfiable ranges', async () => {
    const res = await app.inject({ method: 'GET', url: rec.publicUrl, headers: { range: 'bytes=999999-' } });
    expect(res.statusCode).toBe(416);
  });

  it('blocks path traversal', async () => {
    const res = await app.inject({ method: 'GET', url: '/cdn/../../metadata/assets.json' });
    expect([400, 404]).toContain(res.statusCode);
  });

  it('compresses text responses when requested', async () => {
    const res = await app.inject({ method: 'GET', url: rec.publicUrl, headers: { 'accept-encoding': 'gzip' } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-encoding']).toBe('gzip');
  });

  it('tracks downloads via batched metadata updates', async () => {
    await app.inject({ method: 'GET', url: rec.publicUrl });
    await app.mb['stats'].onDownloads(0); // ensure store writable
    // give the 2s download tracker a moment to flush
    await new Promise(r => setTimeout(r, 2500));
    const after = await app.inject({ method: 'GET', url: `/api/v1/assets/${rec.id}`, headers: { authorization: `Bearer ${token}` } });
    expect(JSON.parse(after.payload).downloads).toBeGreaterThan(0);
  });
});