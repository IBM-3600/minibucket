import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeApp, login, uploadFile, PNG_1PX } from './helpers.js';

let app: FastifyInstance;
let dir: string;
let token: string;

beforeAll(async () => { ({ app, dir } = await makeApp()); token = await login(app); });
afterAll(async () => { await app.close(); });

describe('REST API end-to-end', () => {
  it('rejects unauthenticated list', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/assets' });
    expect(res.statusCode).toBe(401);
  });

  it('uploads files into correct category/extension folders with metadata', async () => {
    const res = await uploadFile(app, token, 'banner.png', PNG_1PX, 'image/png');
    expect(res.statusCode).toBe(201);
    const rec = JSON.parse(res.payload).assets[0];
    expect(rec.category).toBe('images');
    expect(rec.relativePath.startsWith('images/png/')).toBe(true);
    expect(rec.storedName).toMatch(/^banner-[0-9a-f]{8}\.png$/); // hash naming, collision-safe
    expect(rec.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(rec.publicUrl).toBe(`/cdn/${rec.relativePath}`);
    expect(rec.sizeBytes).toBe(PNG_1PX.length);
  });

  it('stores document/code/archive categories correctly', async () => {
    const md = await uploadFile(app, token, 'notes.md', Buffer.from('# hello'), 'text/markdown');
    const json = await uploadFile(app, token, 'data.json', Buffer.from('{"a":1}'), 'application/json');
    expect(JSON.parse(md.payload).assets[0].relativePath.startsWith('documents/md/')).toBe(true);
    expect(JSON.parse(json.payload).assets[0].relativePath.startsWith('code/json/')).toBe(true);
  });

  it('blocks dangerous extensions', async () => {
    const res = await uploadFile(app, token, 'evil.exe', Buffer.from('MZ'));
    expect(res.statusCode).toBe(415);
  });

  it('never overwrites: same name twice → distinct stored names', async () => {
    const r1 = await uploadFile(app, token, 'same.txt', Buffer.from('one'), 'text/plain');
    const r2 = await uploadFile(app, token, 'same.txt', Buffer.from('two'), 'text/plain');
    const a = JSON.parse(r1.payload).assets[0];
    const b = JSON.parse(r2.payload).assets[0];
    expect(a.storedName).not.toBe(b.storedName);
    expect(a.relativePath).not.toBe(b.relativePath);
  });

  it('dedupes identical content when DEDUPE=true', async () => {
    const payload = Buffer.from('dedupe-me-' + Math.random());
    const r1 = await uploadFile(app, token, 'dup.txt', payload, 'text/plain');
    const r2 = await uploadFile(app, token, 'dup.txt', payload, 'text/plain');
    const a = JSON.parse(r1.payload).assets[0];
    const b = JSON.parse(r2.payload).assets[0];
    expect(b.deduplicated).toBe(true);
    expect(b.id).toBe(a.id);
  });

  it('lists/searches from the index with filters and pagination', async () => {
    const list = JSON.parse((await app.inject({ method: 'GET', url: '/api/v1/assets?perPage=2&page=1', headers: { authorization: `Bearer ${token}` } })).payload);
    expect(list.items.length).toBeLessThanOrEqual(2);
    expect(list.total).toBeGreaterThan(2);

    const search = JSON.parse((await app.inject({ method: 'GET', url: '/api/v1/search?q=notes', headers: { authorization: `Bearer ${token}` } })).payload);
    expect(search.items.some((r: any) => r.originalName === 'notes.md')).toBe(true);

    const cat = JSON.parse((await app.inject({ method: 'GET', url: '/api/v1/assets?category=images', headers: { authorization: `Bearer ${token}` } })).payload);
    expect(cat.items.every((r: any) => r.category === 'images')).toBe(true);
  });

  it('soft-deletes to trash and restores', async () => {
    const up = await uploadFile(app, token, 'trashme.txt', Buffer.from('trash'), 'text/plain');
    const rec = JSON.parse(up.payload).assets[0];
    const del = await app.inject({ method: 'DELETE', url: `/api/v1/assets/${rec.id}`, headers: { authorization: `Bearer ${token}` } });
    expect(del.statusCode).toBe(200);
    const trashed = JSON.parse((await app.inject({ method: 'GET', url: '/api/v1/assets?trashed=true', headers: { authorization: `Bearer ${token}` } })).payload);
    expect(trashed.items.some((r: any) => r.id === rec.id)).toBe(true);
    const restored = await app.inject({ method: 'POST', url: `/api/v1/assets/${rec.id}/restore`, headers: { authorization: `Bearer ${token}` } });
    expect(restored.statusCode).toBe(200);
  });

  it('chunked/resumable upload produces a valid asset', async () => {
    const data = Buffer.from('chunked-payload-'.repeat(500));
    const init = JSON.parse((await app.inject({
      method: 'POST', url: '/api/v1/assets/multipart', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { filename: 'chunked.txt', size: data.length }
    })).payload);
    const chunkSize = Math.ceil(data.length / 3);
    for (let i = 0; i < 3; i++) {
      const chunk = data.subarray(i * chunkSize, Math.min(data.length, (i + 1) * chunkSize));
      const put = await app.inject({
        method: 'PUT', url: `/api/v1/assets/multipart/${init.uploadId}/chunk/${i}`,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' },
        payload: chunk
      });
      expect(put.statusCode).toBe(200);
    }
    const done = await app.inject({
      method: 'POST', url: `/api/v1/assets/multipart/${init.uploadId}/complete`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, payload: {}
    });
    expect(done.statusCode).toBe(201);
    const rec = JSON.parse(done.payload);
    expect(rec.sizeBytes).toBe(data.length);
    expect(rec.category).toBe('documents');
  });

  it('RBAC: viewer-role key cannot upload', async () => {
    const keyRes = JSON.parse((await app.inject({
      method: 'POST', url: '/api/v1/api-keys', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { name: 'reader', role: 'viewer', scopes: ['read'] }
    })).payload);
    const up = await uploadFile(app, keyRes.key, 'nope.txt', Buffer.from('x'));
    expect(up.statusCode).toBe(403);
    const list = await app.inject({ method: 'GET', url: '/api/v1/assets', headers: { 'x-api-key': keyRes.key } });
    expect(list.statusCode).toBe(200);
  });
});