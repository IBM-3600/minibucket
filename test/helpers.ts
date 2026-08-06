import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { buildApp } from '../src/app.js';
import type { FastifyInstance } from 'fastify';

export async function makeApp(): Promise<{ app: FastifyInstance; dir: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'minibucket-test-'));
  const app = await buildApp({
    storageDir: dir,
    publicDir: path.resolve('./public'),
    categoriesFile: path.resolve('./config/categories.json'),
    adminPassword: 'test-password-123',
    jwtSecret: 'test-secret',
    thumbnailEnabled: false,
    dedupe: true,
    logLevel: 'silent' as never
  });
  return { app, dir };
}

export const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

export function multipartBody(boundary: string, files: { name: string; filename: string; contentType: string; data: Buffer }[], fields: Record<string, string> = {}): Buffer {
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  for (const f of files) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${f.name}"; filename="${f.filename}"\r\nContent-Type: ${f.contentType}\r\n\r\n`));
    parts.push(f.data);
    parts.push(Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(parts);
}

export async function login(app: FastifyInstance): Promise<string> {
  const res = await app.inject({
    method: 'POST', url: '/api/v1/auth/login',
    payload: { password: 'test-password-123' },
    headers: { 'content-type': 'application/json' }
  });
  return JSON.parse(res.payload).token as string;
}

export async function uploadFile(app: FastifyInstance, token: string, filename: string, data: Buffer, contentType = 'application/octet-stream') {
  const boundary = '----mbtestboundary';
  return app.inject({
    method: 'POST', url: '/api/v1/assets',
    headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: multipartBody(boundary, [{ name: 'file', filename, contentType, data }])
  });
}