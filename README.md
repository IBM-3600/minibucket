# 🪣 MiniBucket

**Self-hosted S3-style asset storage, CDN origin, and asset management platform.**
Node.js + TypeScript + Fastify backend · framework-free vanilla JS admin dashboard · JSON metadata indexes (no database) · local filesystem storage behind a pluggable adapter interface.

Built for developers, studios, game engines and web apps that need to store, index, preview and serve **millions of assets** without cloud lock-in.

---

## ✨ Feature highlights

| Area | What you get |
|---|---|
| Storage | Category/extension folder tree (`images/png/…`, `models/glb/…`), collision-safe naming (`hash`, `timestamp`, `uuid`), SHA-256 on every upload, optional dedupe |
| Metadata | JSON indexes are the single source of truth. **No filesystem scans** during normal operation. Atomic writes (tmp→rename), serialized mutation queue, rolling backups, validation + recovery on startup |
| Uploads | Browser UI, drag & drop, folder upload, clipboard paste, streaming multipart, chunked + **resumable** uploads with pause/resume/retry, multi-GB files |
| CDN | `/cdn/*` zero-copy streaming, HTTP Range (206/416), ETag, Last-Modified, If-None-Match → 304, `Cache-Control: public, max-age, immutable`, on-the-fly Brotli/Gzip for text-like types, CORS |
| API | Versioned REST (`/api/v1/*`), pagination/sorting/filtering/full-text search, OpenAPI spec at `/api/openapi.json`, docs at `/api/docs` |
| Auth | JWT login + refresh tokens, API keys with scopes/expiry/rate limits/IP allowlists, RBAC (admin/editor/uploader/viewer), scrypt password hashing |
| Ops | Statistics engine, audit log, SSE live updates, background job queue (thumbnails/previews via `sharp`/`ffmpeg`), trash + restore, explicit `rebuild-index` |
| S3 | Optional compatibility layer (`/s3`) with real AWS SigV4 verification: Put/Get/Head/Delete/ListObjectsV2 |

---

## 🚀 Quickstart

```bash
git clone <repo> minibucket && cd minibucket
npm install
cp .env.example .env          # edit JWT_SECRET + ADMIN_PASSWORD
npm run dev                   # http://localhost:8080
```

Log in with `admin` / your `ADMIN_PASSWORD`. Then try the E2E demo:

```bash
# terminal 2 — uploads 8 file types, validates metadata, proves CDN 200/304/206
npm run seed
```

### Docker

```bash
docker compose up -d --build
# data persists in ./data
```

### Tests

```bash
npm test    # store integrity, concurrency, API e2e, CDN behavior, restart recovery
```

---

## 🏛 Architecture

```
                        ┌────────────────────────────────────────────┐
   Browser dashboard ──▶│  Fastify HTTP                              │
   REST API clients ───▶│  /api/v1/*   /cdn/*   /s3/*   /health      │
   S3 SDKs (SigV4) ────▶│     │            │          │              │
                        │     ▼            ▼          ▼              │
                        │  Auth (JWT/API key/RBAC/rate limit)        │
                        │     │                                      │
                        │     ▼                                      │
                        │  AssetsService ──▶ JobQueue (thumbnails…)  │
                        │     │                   │                  │
                        │     ▼                   ▼                  │
                        │  AssetsIndex        StorageAdapter ──▶ data/assets/…
                        │  (in-memory,        (fs today; S3/R2/GCS   │
                        │   from assets.json)  adapters plug in)     │
                        │     │                                      │
                        │     ▼                                      │
                        │  JsonStore: atomic tmp→rename writes,      │
                        │  serialized mutation queue, backups        │
                        └────────────────────────────────────────────┘
                                   data/
                        ├── assets/<category>/<ext>/…   (objects)
                        ├── metadata/*.json + backups/  (source of truth)
                        ├── thumbnails/  ├── tmp/  └── trash/
```

### Design rules

1. **The filesystem is never scanned** to list assets. All reads (UI, list, search, stats, folders, tags) come from in-memory indexes hydrated from `metadata/*.json` at boot. The single exception is the explicit `POST /api/v1/rebuild-index` (admin), which reconciles the index from disk.
2. **Metadata is crash-safe.** Every write goes through a serialized promise queue → debounced → `*.tmp` + atomic `rename`, with rolling timestamped backups in `metadata/backups/`. Startup validates every document and falls back to the newest healthy backup.
3. **Serving is metadata-free.** `/cdn/*` resolves the path, stats the file, and streams it (zero-copy `fs.createReadStream`). ETags derive from `size+mtime`. Download counters are coalesced by a 2-second batched tracker so hot files never cause per-request writes.
4. **Storage is pluggable.** Everything talks to the `StorageAdapter` interface (`src/storage/adapter.ts`). Implement `S3RemoteAdapter` against any provider SDK and select it via env — REST API and UI are untouched.
5. **Never overwrite.** Stored names are collision-checked against the path index and suffixed (`-2`, `-3`, …) per the configured naming strategy.

---

## 📡 API examples

```bash
# Login
TOKEN=$(curl -s -X POST localhost:8080/api/v1/auth/login \
  -H 'content-type: application/json' -d '{"password":"admin"}' | jq -r .token)

# Upload (multipart, streaming)
curl -X POST localhost:8080/api/v1/assets -H "Authorization: Bearer $TOKEN" \
  -F "file=@./logo.png" -F "tags=branding,homepage" -F "folder=marketing"

# List / filter / paginate
curl -s "localhost:8080/api/v1/assets?category=images&sort=sizeBytes&order=desc&page=1&perPage=20" \
  -H "Authorization: Bearer $TOKEN"

# Full-text search
curl -s "localhost:8080/api/v1/search?q=logo" -H "Authorization: Bearer $TOKEN"

# Update tags / rename
curl -X PATCH localhost:8080/api/v1/assets/<id> -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"tags":["marketing"],"originalName":"logo-v2.png"}'

# Trash → restore / purge
curl -X DELETE localhost:8080/api/v1/assets/<id> -H "Authorization: Bearer $TOKEN"
curl -X POST   localhost:8080/api/v1/assets/<id>/restore -H "Authorization: Bearer $TOKEN"
curl -X DELETE "localhost:8080/api/v1/assets/<id>?purge=1" -H "Authorization: Bearer $TOKEN"

# Resumable chunked upload
UPLOAD=$(curl -s -X POST localhost:8080/api/v1/assets/multipart \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"filename":"big.mp4","size":1073741824}' | jq -r .uploadId)
curl -X PUT "localhost:8080/api/v1/assets/multipart/$UPLOAD/chunk/0" \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/octet-stream' \
  --data-binary @chunk0.bin
curl -X POST "localhost:8080/api/v1/assets/multipart/$UPLOAD/complete" \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{}'

# Rebuild index from disk (the only sanctioned scan)
curl -X POST localhost:8080/api/v1/rebuild-index -H "Authorization: Bearer $TOKEN"

# CDN behavior
curl -I  localhost:8080/cdn/images/png/logo-a1b2c3d4.png
curl -H 'Range: bytes=0-1023' -o part.bin localhost:8080/cdn/videos/mp4/big.mp4
```

Interactive docs: **http://localhost:8080/api/docs** · OpenAPI JSON: `/api/openapi.json`.

---

## 🔌 S3 compatibility

Set `S3_COMPAT_ENABLED=true`. Create credentials:

```bash
curl -X POST localhost:8080/api/v1/s3-credentials -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"label":"ci-pipeline"}'
# → { "accessKeyId": "MB…", "secretAccessKey": "…" }
```

Then use any S3 SDK / tool with path-style addressing:

```bash
aws --endpoint-url http://localhost:8080/s3 s3 cp ./file.png s3://assets/
aws --endpoint-url http://localhost:8080/s3 s3 ls s3://assets --recursive
```

Supported: `PutObject`, `GetObject` (incl. Range), `HeadObject`, `DeleteObject`, `ListObjectsV2` (prefix + paging), `CreateBucket`, `DeleteBucket`. Auth is genuine AWS Signature V4.

---

## 🔐 Security notes

- Executable/dangerous extensions are blocked via `config/categories.json` (`blocked` list); MIME + extension validation on every upload; filenames sanitized; path traversal rejected in both upload and CDN resolution.
- Passwords: scrypt (N=16384). JWTs: HS256 with 1h access / 30d refresh. API keys stored as SHA-256 hashes; plaintext shown exactly once.
- UI is token-authenticated (no ambient cookies → CSRF-resistant), served with CSP, `X-Frame-Options: DENY`, nosniff on CDN.
- Rate limiting per credential (token bucket); per-key overrides (`rateLimitRpm`), IP allowlists, expiry, scopes (`read/write/delete/admin`).
- Antivirus hook: add a job handler for `scan` in `registerThumbnailJobs`-style fashion and call it from `AssetsService.finalize` (extension point documented in code).

---

## 🗄 Backup, recovery & operations

- **Backup:** snapshot the entire `STORAGE_DIR` (assets + metadata + thumbnails). The metadata JSON is small relative to objects; `metadata/backups/` already holds rolling pre-write snapshots.
- **Recovery:** if a metadata file is corrupt, startup auto-restores the newest valid backup. Worst case: delete `metadata/*.json` and run `POST /api/v1/rebuild-index` (or `npm run rebuild-index`) to reconstruct the full index from disk, preserving nothing but what's derivable (tags/folders are lost in that scenario — prefer backups).
- **Scaling:** the job queue and stores are interface-stable; swap `JobQueue` for BullMQ/worker_threads, shard `assets.json` into per-category stores, or point `StorageAdapter` at S3/R2 — no API/UI changes. For >1M assets, consider SQLite/LMDB as an alternate index backend behind the same `AssetsIndex` interface.
- **Reverse proxy:** put nginx/caddy in front; `/cdn/*` is immutable-cache friendly, so edge caching works out of the box.

---

## ✅ Acceptance criteria mapping

| Criterion | Where it's satisfied |
|---|---|
| UI/API upload → list → preview → delete end-to-end | `public/js/pages/*`, `/api/v1/assets*`, tested in `test/api.test.ts`, demoed by `npm run seed` |
| Correct category/extension folders, collision-safe names | `storage/layout.ts`, `AssetsService.allocatePath`, asserted in tests |
| Concurrent uploads never corrupt metadata | `JsonStore` serialized queue + atomic writes, proven in `test/concurrent.test.ts` |
| UI/list APIs never scan the filesystem | All reads via `AssetsIndex`; only `rebuild-index` walks disk |
| CDN cache headers, ETag, 304, Range | `routes/cdn.ts`, asserted in `test/cdn.test.ts` |
| Clean restart from JSON indexes | Stores hydrate on boot; restart assertion in `test/concurrent.test.ts` |
| Future storage providers / S3 compat without API/UI changes | `StorageAdapter` interface + `routes/s3.ts` |
