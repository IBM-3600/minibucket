import type { FastifyInstance } from 'fastify';
import { VERSION } from './config.js';

const bearer = [{ bearerAuth: [] }, { apiKey: [] }];
const json = { 'application/json': { schema: { type: 'object' } } };

export const OPENAPI = {
  openapi: '3.0.3',
  info: { title: 'MiniBucket API', version: VERSION, description: 'Self-hosted S3-style object storage, CDN origin and asset platform.' },
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      apiKey: { type: 'apiKey', in: 'header', name: 'x-api-key' }
    }
  },
  paths: {
    '/health': { get: { summary: 'Liveness + counters', security: [], responses: { 200: { description: 'ok' } } } },
    '/api/v1/auth/login': { post: { summary: 'Login (JWT + refresh token)', security: [], requestBody: { content: json }, responses: { 200: { description: 'tokens' } } } },
    '/api/v1/auth/refresh': { post: { summary: 'Exchange refresh token for access token', security: [], responses: { 200: { description: 'token' } } } },
    '/api/v1/assets': {
      get: { summary: 'List assets (paginated, filterable)', security: bearer, parameters: [
        { name: 'q', in: 'query' }, { name: 'category', in: 'query' }, { name: 'tag', in: 'query' },
        { name: 'mime', in: 'query' }, { name: 'ext', in: 'query' }, { name: 'folder', in: 'query' },
        { name: 'from', in: 'query' }, { name: 'to', in: 'query' }, { name: 'minSize', in: 'query' },
        { name: 'maxSize', in: 'query' }, { name: 'sort', in: 'query' }, { name: 'order', in: 'query' },
        { name: 'page', in: 'query' }, { name: 'perPage', in: 'query' }
      ].map(p => ({ ...p, schema: { type: 'string' } })), responses: { 200: { description: 'paginated list' } } },
      post: { summary: 'Multipart upload (one or many files)', security: bearer, responses: { 201: { description: 'created assets' } } }
    },
    '/api/v1/assets/multipart': { post: { summary: 'Init resumable chunked upload', security: bearer, responses: { 201: { description: 'uploadId + chunkSize' } } } },
    '/api/v1/assets/multipart/{uploadId}': { get: { summary: 'Upload session status (for resume)', security: bearer, responses: { 200: { description: 'received parts' } } } },
    '/api/v1/assets/multipart/{uploadId}/chunk/{index}': { put: { summary: 'Upload one chunk (octet-stream)', security: bearer, responses: { 200: { description: 'ack' } } } },
    '/api/v1/assets/multipart/{uploadId}/complete': { post: { summary: 'Assemble chunks into an asset', security: bearer, responses: { 201: { description: 'asset' } } } },
    '/api/v1/assets/{id}': {
      get: { summary: 'Get asset metadata', security: bearer, responses: { 200: { description: 'asset' } } },
      patch: { summary: 'Update metadata (tags, name, folder)', security: bearer, responses: { 200: { description: 'updated' } } },
      delete: { summary: 'Soft-delete (trash). ?purge=1 removes from trash', security: bearer, responses: { 200: { description: 'deleted' } } }
    },
    '/api/v1/assets/{id}/restore': { post: { summary: 'Restore from trash', security: bearer, responses: { 200: { description: 'asset' } } } },
    '/api/v1/assets/bulk': { post: { summary: 'Bulk delete/restore/purge/tag/move', security: bearer, responses: { 200: { description: '{ok,failed}' } } } },
    '/api/v1/search': { get: { summary: 'Full-text search (alias of assets list with q)', security: bearer, responses: { 200: { description: 'results' } } } },
    '/api/v1/statistics': { get: { summary: 'Storage statistics', security: bearer, responses: { 200: { description: 'stats' } } } },
    '/api/v1/folders': {
      get: { summary: 'List logical folders', security: bearer, responses: { 200: { description: 'folders' } } },
      post: { summary: 'Create folder', security: bearer, responses: { 201: { description: 'created' } } },
      patch: { summary: 'Rename folder', security: bearer, responses: { 200: { description: 'ok' } } }
    },
    '/api/v1/tags': { get: { summary: 'Tag aggregation with counts', security: bearer, responses: { 200: { description: 'tags' } } } },
    '/api/v1/api-keys': {
      get: { summary: 'List API keys', security: bearer, responses: { 200: { description: 'keys' } } },
      post: { summary: 'Create API key (plaintext returned once)', security: bearer, responses: { 201: { description: 'key + record' } } }
    },
    '/api/v1/users': {
      get: { summary: 'List users', security: bearer, responses: { 200: { description: 'users' } } },
      post: { summary: 'Create user', security: bearer, responses: { 201: { description: 'user' } } }
    },
    '/api/v1/activity': { get: { summary: 'Audit log', security: bearer, responses: { 200: { description: 'entries' } } } },
    '/api/v1/rebuild-index': { post: { summary: 'Rebuild metadata index from filesystem (explicit scan)', security: bearer, responses: { 200: { description: 'report' } } } },
    '/api/v1/events': { get: { summary: 'SSE live update stream', security: bearer, responses: { 200: { description: 'event stream' } } } },
    '/cdn/{path}': { get: { summary: 'CDN delivery (Range, ETag, 304, immutable caching)', security: [], responses: { 200: { description: 'bytes' }, 206: { description: 'partial' }, 304: { description: 'not modified' } } }
  }
}};

export function registerDocs(app: FastifyInstance): void {
  app.get('/api/openapi.json', async () => OPENAPI);
  app.get('/api/docs', async (_req, reply) => {
    const rows = Object.entries(OPENAPI.paths).map(([path, methods]) =>
      Object.entries(methods as Record<string, any>).map(([method, op]: [string, any]) =>
        `<tr><td><code class="m ${method}">${method.toUpperCase()}</code></td><td><code>${path}</code></td><td>${op.summary ?? ''}</td></tr>`).join('')
    ).join('');
    return reply.type('text/html').send(`<!doctype html><html><head><meta charset="utf-8"><title>MiniBucket API</title>
<style>body{font-family:ui-sans-serif,system-ui;background:#0b0e14;color:#dbe2ef;padding:2rem;max-width:980px;margin:auto}
h1{font-size:1.4rem}table{border-collapse:collapse;width:100%;font-size:.9rem}td{border-bottom:1px solid #1d2534;padding:.5rem .6rem}
code{color:#8ab4ff}.m{font-weight:700;padding:2px 8px;border-radius:6px;background:#1d2534}
.get{color:#5fd39a}.post{color:#8ab4ff}.patch{color:#e8c268}.delete{color:#ff7b72}.put{color:#c792ea}</style></head>
<body><h1>MiniBucket API v1</h1><p>Auth: <code>Authorization: Bearer &lt;jwt&gt;</code> or <code>x-api-key: mbk_…</code>. Full spec at <a style="color:#8ab4ff" href="/api/openapi.json">/api/openapi.json</a>.</p>
<table>${rows}</table></body></html>`);
  });
}