#!/usr/bin/env node
/**
 * MiniBucket end-to-end smoke test.
 * Requires a running server:  BASE_URL=http://localhost:8080 PASSWORD=admin npm run seed
 */
const BASE = process.env.BASE_URL ?? 'http://localhost:8080';
const PASSWORD = process.env.PASSWORD ?? process.env.UI_PASSWORD ?? 'admin';

const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const EMPTY_ZIP = Buffer.from('UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA==', 'base64');
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="30" fill="#4f8cff"/></svg>');

const SAMPLES = [
  { name: 'sample.png',       type: 'image/png',           data: PNG_1PX,                     category: 'images' },
  { name: 'logo.svg',         type: 'image/svg+xml',       data: SVG,                         category: 'images' },
  { name: 'readme.md',        type: 'text/markdown',       data: Buffer.from('# MiniBucket\n\nseed test'), category: 'documents' },
  { name: 'config.json',      type: 'application/json',    data: Buffer.from('{"hello":"minibucket"}'), category: 'code' },
  { name: 'report.csv',       type: 'text/csv',            data: Buffer.from('a,b\n1,2\n'),   category: 'documents' },
  { name: 'bundle.zip',       type: 'application/zip',     data: EMPTY_ZIP,                   category: 'archives' },
  { name: 'theme.mp3',        type: 'audio/mpeg',          data: Buffer.from('ID3fake-audio-bytes'), category: 'audio' },
  { name: 'mesh.glb',         type: 'model/gltf-binary',   data: Buffer.concat([Buffer.from('glTF'), Buffer.alloc(64)]), category: 'models' }
];

let pass = 0, fail = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? '  ✅ PASS' : '  ❌ FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`);
  ok ? pass++ : fail++;
};

// 1. Login
console.log(`\n▸ Target: ${BASE}`);
const loginRes = await fetch(`${BASE}/api/v1/auth/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ password: PASSWORD })
});
if (!loginRes.ok) { console.error('Login failed:', await loginRes.text()); process.exit(1); }
const { token } = await loginRes.json();
const auth = { authorization: `Bearer ${token}` };
check('login', true);

// 2. Upload each sample
console.log('\n▸ Uploading samples…');
const uploaded = [];
for (const s of SAMPLES) {
  const fd = new FormData();
  fd.append('file', new Blob([s.data], { type: s.type }), s.name);
  fd.append('tags', 'seed-test');
  fd.append('source', 'api');
  const res = await fetch(`${BASE}/api/v1/assets`, { method: 'POST', headers: auth, body: fd });
  const body = await res.json();
  const rec = body.assets?.[0];
  const ok = res.status === 201 && rec?.category === s.category &&
    rec.relativePath.startsWith(s.category) && /^[0-9a-f]{64}$/.test(rec.sha256) &&
    rec.publicUrl.startsWith('/cdn/') && rec.sizeBytes === s.data.length;
  check(`upload ${s.name}`, ok, `→ ${rec?.relativePath}`);
  uploaded.push(rec);
}

// 3. Dedupe check (upload same PNG again)
{
  const fd = new FormData();
  fd.append('file', new Blob([PNG_1PX], { type: 'image/png' }), 'sample.png');
  const res = await fetch(`${BASE}/api/v1/assets`, { method: 'POST', headers: auth, body: fd });
  const rec = (await res.json()).assets[0];
  check('dedupe returns existing record', rec.deduplicated === true && rec.id === uploaded[0].id);
}

// 4. List + search from metadata index
{
  const list = await (await fetch(`${BASE}/api/v1/assets?perPage=100&tag=seed-test`, { headers: auth })).json();
  check('list returns uploaded records from index', list.total >= SAMPLES.length);
  const search = await (await fetch(`${BASE}/api/v1/search?q=readme`, { headers: auth })).json();
  check('search finds readme.md', search.items.some(r => r.originalName === 'readme.md'));
  const stats = await (await fetch(`${BASE}/api/v1/statistics`, { headers: auth })).json();
  check('statistics populated', stats.totalAssets >= SAMPLES.length && stats.totalBytes > 0,
    `${stats.totalAssets} assets, ${stats.totalBytes} bytes`);
}

// 5. CDN delivery
console.log('\n▸ CDN delivery…');
for (const rec of uploaded.slice(0, 3)) {
  const res = await fetch(`${BASE}${rec.publicUrl}`);
  const cc = res.headers.get('cache-control') ?? '';
  check(`GET ${rec.publicUrl}`, res.status === 200 && cc.includes('immutable') && !!res.headers.get('etag'),
    `etag=${res.headers.get('etag')}`);

  // 304
  const notModified = await fetch(`${BASE}${rec.publicUrl}`, { headers: { 'if-none-match': res.headers.get('etag') } });
  check(`304 ${rec.storedName}`, notModified.status === 304);

  // Range
  const ranged = await fetch(`${BASE}${rec.publicUrl}`, { headers: { range: 'bytes=0-9' } });
  const buf = Buffer.from(await ranged.arrayBuffer());
  check(`Range 0-9 ${rec.storedName}`, ranged.status === 206 && buf.length === 10,
    ranged.headers.get('content-range'));
}

// 6. Health
{
  const health = await (await fetch(`${BASE}/health`)).json();
  check('health endpoint', health.status === 'ok');
}

console.log(`\nResult: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);