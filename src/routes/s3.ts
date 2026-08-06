import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { verifySigV4 } from '../s3/sigv4.js';
import { ApiError } from '../services/assets-service.js';

const xmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Optional S3 compatibility layer (enable with S3_COMPAT_ENABLED=true).
 * Buckets map to the single asset root; keys map to asset relative paths.
 * Works with aws-cli / SDKs using path-style addressing.
 */
export function registerS3Routes(app: FastifyInstance): void {
  const ctx = app.mb;

  app.addHook('preHandler', async () => {}); // placeholder for future global s3 hooks

  const handler = async (req: any, reply: any) => {
    const bucket = req.params.bucket as string;
    const key = req.params['*'] ? String(req.params['*']) : '';

    if (bucket !== ctx.config.s3Bucket) {
      return reply.code(404).type('application/xml').send(xmlError('NoSuchBucket', `bucket ${bucket} does not exist`));
    }

    // SigV4 auth
    const rawUrl: string = req.raw.url ?? '';
    const qIdx = rawUrl.indexOf('?');
    const rawPath = qIdx === -1 ? rawUrl : rawUrl.slice(0, qIdx);
    const rawQuery = qIdx === -1 ? '' : rawUrl.slice(qIdx + 1);
    const authHeader = String(req.headers.authorization ?? '');
    const credMatch = /Credential=([^/]+)\//.exec(authHeader);
    const cred = credMatch ? ctx.s3creds.get(credMatch[1]) : undefined;
    if (!cred) return reply.code(403).type('application/xml').send(xmlError('InvalidAccessKeyId', 'unknown access key'));
    const result = verifySigV4({ method: req.method, rawPath, rawQuery, headers: req.headers }, cred.secretAccessKey);
    if (!result.ok) return reply.code(403).type('application/xml').send(xmlError('SignatureDoesNotMatch', result.error ?? 'bad signature'));

    try {
      // ── Bucket-level ops ────────────────────────────────────────────
      if (!key) {
        if (req.method === 'PUT') return reply.code(200).type('application/xml').send(`<CreateBucketResponse><Bucket>${bucket}</Bucket></CreateBucketResponse>`);
        if (req.method === 'DELETE') {
          if (ctx.assets.count() > 0) return reply.code(409).type('application/xml').send(xmlError('BucketNotEmpty', 'bucket has objects'));
          return reply.code(204).send();
        }
        if (req.method === 'GET' || req.method === 'HEAD') {
          return listObjectsV2(app, req, reply);
        }
      }

      // ── Object ops ─────────────────────────────────────────────────
      switch (req.method) {
        case 'PUT': return putObject(app, req, reply, key);
        case 'GET': return getObject(app, req, reply, key);
        case 'HEAD': return headObject(app, req, reply, key);
        case 'DELETE': return deleteObject(app, req, reply, key);
        default: return reply.code(405).type('application/xml').send(xmlError('MethodNotAllowed', req.method));
      }
    } catch (err) {
      if (err instanceof ApiError) return reply.code(err.statusCode).type('application/xml').send(xmlError('InternalError', err.message));
      req.log.error(err);
      return reply.code(500).type('application/xml').send(xmlError('InternalError', 'internal error'));
    }
  };

  app.get('/s3/:bucket', handler);
  app.head('/s3/:bucket', handler);
  app.put('/s3/:bucket', handler);
  app.delete('/s3/:bucket', handler);
  app.all('/s3/:bucket/*', handler);

  async function putObject(app: FastifyInstance, req: any, reply: any, key: string) {
    const ctx = app.mb;
    const rec = await ctx.service.ingestStream({
      stream: req.body,
      originalName: key.split('/').pop() ?? key,
      source: 's3',
      uploadedBy: 's3'
    });
    return reply.code(200).header('ETag', rec.etag).send();
  }

  async function getObject(app: FastifyInstance, req: any, reply: any, key: string) {
    const ctx = app.mb;
    const rec = ctx.assets.findByPath(key);
    if (!rec || rec.deletedAt) return reply.code(404).type('application/xml').send(xmlError('NoSuchKey', key));
    const st = await ctx.adapter.stat(rec.relativePath);
    if (!st) return reply.code(404).type('application/xml').send(xmlError('NoSuchKey', key));
    reply.header('ETag', rec.etag)
      .header('Last-Modified', new Date(st.mtimeMs).toUTCString())
      .header('Accept-Ranges', 'bytes')
      .header('Content-Type', rec.mimeType);
    const range = req.headers.range;
    if (typeof range === 'string' && range.startsWith('bytes=')) {
      const m = /^bytes=(\d+)-(\d*)$/.exec(range);
      if (m) {
        const start = parseInt(m[1], 10);
        const end = m[2] ? Math.min(parseInt(m[2], 10), st.size - 1) : st.size - 1;
        const stream = await ctx.adapter.createReadStream(rec.relativePath, { start, end });
        return reply.code(206).header('Content-Range', `bytes ${start}-${end}/${st.size}`).header('Content-Length', end - start + 1).send(stream);
      }
    }
    const stream = await ctx.adapter.createReadStream(rec.relativePath);
    return reply.header('Content-Length', st.size).send(stream);
  }

  async function headObject(app: FastifyInstance, req: any, reply: any, key: string) {
    void req;
    const ctx = app.mb;
    const rec = ctx.assets.findByPath(key);
    if (!rec || rec.deletedAt) return reply.code(404).send();
    return reply.code(200)
      .header('ETag', rec.etag)
      .header('Content-Length', rec.sizeBytes)
      .header('Content-Type', rec.mimeType)
      .send();
  }

  async function deleteObject(app: FastifyInstance, req: any, reply: any, key: string) {
    const ctx = app.mb;
    const rec = ctx.assets.findByPath(key);
    if (rec && !rec.deletedAt) await ctx.service.softDelete(rec.id, 's3');
    return reply.code(204).send(); // S3 semantics: delete of missing key succeeds
  }

  async function listObjectsV2(app: FastifyInstance, req: any, reply: any) {
    const ctx = app.mb;
    const prefix = String(req.query?.prefix ?? '');
    const maxKeys = Math.min(1000, Number(req.query?.['max-keys'] ?? 1000));
    const continuationToken = req.query?.['continuation-token'] ? Buffer.from(String(req.query['continuation-token']), 'base64url').toString() : '';
    let keys = ctx.assets.findByPrefix(prefix).filter(r => r.relativePath > continuationToken);
    const truncated = keys.length > maxKeys;
    keys = keys.slice(0, maxKeys);
    const nextToken = truncated && keys.length > 0 ? Buffer.from(keys[keys.length - 1].relativePath).toString('base64url') : '';

    const contents = keys.map(r => `    <Contents>
      <Key>${xmlEscape(r.relativePath)}</Key>
      <LastModified>${r.updatedAt}</LastModified>
      <ETag>${xmlEscape(r.etag)}</ETag>
      <Size>${r.sizeBytes}</Size>
      <StorageClass>STANDARD</StorageClass>
    </Contents>`).join('\n');

    return reply.code(200).type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Name>${xmlEscape(ctx.config.s3Bucket)}</Name>
  <Prefix>${xmlEscape(prefix)}</Prefix>
  <KeyCount>${keys.length}</KeyCount>
  <MaxKeys>${maxKeys}</MaxKeys>
  <IsTruncated>${truncated}</IsTruncated>
  ${nextToken ? `<NextContinuationToken>${nextToken}</NextContinuationToken>` : ''}
${contents}
</ListBucketResult>`);
  }

  function xmlError(code: string, message: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<Error><Code>${code}</Code><Message>${xmlEscape(message)}</Message></Error>`;
  }
}