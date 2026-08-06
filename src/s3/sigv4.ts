import crypto from 'node:crypto';

const hmac = (key: Buffer | string, data: string) => crypto.createHmac('sha256', key).update(data).digest();
const sha256hex = (data: string | Buffer) => crypto.createHash('sha256').update(data).digest('hex');

export interface SigV4Request {
  method: string;
  /** Raw path WITHOUT query string, as received on the wire. */
  rawPath: string;
  rawQuery: string;
  headers: Record<string, string | string[] | undefined>;
}

export interface SigV4Result { ok: boolean; error?: string; signedHeaders?: string[]; }

/** Verify AWS Signature Version 4 (header-based Authorization). */
export function verifySigV4(req: SigV4Request, secretAccessKey: string): SigV4Result {
  const authHeader = String(req.headers['authorization'] ?? '');
  const m = /^AWS4-HMAC-SHA256\s+Credential=([^/]+)\/(\d{8})\/([^/]+)\/([^/]+)\/aws4_request,\s*SignedHeaders=([^,]+),\s*Signature=([0-9a-f]{64})$/i.exec(authHeader);
  if (!m) return { ok: false, error: 'malformed Authorization header' };
  const [, accessKeyId, datestamp, region, service, signedHeadersStr, providedSig] = m;
  void accessKeyId; void region; void service;

  const amzDate = String(req.headers['x-amz-date'] ?? '');
  if (!amzDate) return { ok: false, error: 'missing x-amz-date' };

  const signedHeaders = signedHeadersStr.split(';').map(h => h.trim().toLowerCase()).sort();

  // Canonical URI: encode each path segment (RFC3986), preserve slashes.
  const canonicalUri = req.rawPath.split('/').map(seg => encodeURIComponent(decodeURIComponent(seg))).join('/') || '/';

  // Canonical query string: sorted by key then value.
  const params = new URLSearchParams(req.rawQuery);
  const qEntries: [string, string][] = [];
  params.forEach((v, k) => qEntries.push([k, v]));
  qEntries.sort((a, b) => a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0]));
  const canonicalQuery = qEntries
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');

  const canonicalHeaders = signedHeaders
    .map(h => `${h}:${String(req.headers[h] ?? '').toString().trim().replace(/\s+/g, ' ')}\n`)
    .join('');

  const payloadHash = String(req.headers['x-amz-content-sha256'] ?? 'UNSIGNED-PAYLOAD');

  const canonicalRequest = [req.method.toUpperCase(), canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders.join(';'), payloadHash].join('\n');
  const scope = `${datestamp}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');

  const kDate = hmac(`AWS4${secretAccessKey}`, datestamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = hmac(kSigning, stringToSign).toString('hex');

  const a = Buffer.from(signature); const b = Buffer.from(providedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, error: 'signature mismatch' };
  return { ok: true, signedHeaders };
}