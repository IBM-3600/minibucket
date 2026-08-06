import path from 'node:path';
import fs from 'node:fs/promises';
import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';

import { loadConfig, applyRuntimeSettings } from './config.js';
import type { AppConfig, AppContext, AssetRecord, StatsShape, ActivityEntry, UserInfo, ApiKeyInfo, S3Credential } from './types.js';
import { Logger } from './lib/logger.js';
import { EventBus } from './lib/event-bus.js';
import { RateLimiter } from './lib/rate-limiter.js';
import { JsonStore } from './metadata/json-store.js';
import { AssetsIndex } from './metadata/assets-index.js';
import { StatsEngine, dayKeyUTC } from './metadata/stats-engine.js';
import { ActivityLog } from './metadata/activity-log.js';
import { UsersRepo } from './metadata/users.js';
import { ApiKeysRepo } from './metadata/api-keys.js';
import { S3CredsRepo } from './metadata/s3-creds.js';
import { FoldersRepo } from './metadata/folders.js';
import { SettingsRepo } from './metadata/settings.js';
import { Layout, loadCategoriesConfig } from './storage/layout.js';
import { FsStorageAdapter } from './storage/fs-adapter.js';
import { AssetsService } from './services/assets-service.js';
import { UploadSessionManager } from './services/upload-sessions.js';
import { DownloadTracker } from './services/download-tracker.js';
import { registerThumbnailJobs } from './services/thumbnails.js';
import { JobQueue } from './workers/queue.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerAssetRoutes } from './routes/assets.js';
import { registerUploadRoutes } from './routes/upload.js';
import { registerCdnRoutes } from './routes/cdn.js';
import { registerMiscRoutes } from './routes/misc.js';
import { registerAdminRoutes } from './routes/keys-users.js';
import { registerS3Routes } from './routes/s3.js';
import { registerDocs } from './openapi.js';

export async function buildApp(overrides: Partial<AppConfig> = {}): Promise<FastifyInstance> {
  const config = loadConfig(overrides);
  const logger = new Logger(config.logLevel as any);
  const metaDir = path.join(config.storageDir, 'metadata');
  const backupDir = path.join(metaDir, 'backups');
  await fs.mkdir(metaDir, { recursive: true });
  await fs.mkdir(path.join(config.storageDir, 'thumbnails'), { recursive: true });
  await fs.mkdir(path.join(config.storageDir, 'tmp', 'multipart'), { recursive: true });

  // ── Stores ──────────────────────────────────────────────────────────────
  const assetsStore = new JsonStore<{ assets: Record<string, AssetRecord> }>({
    file: path.join(metaDir, 'assets.json'), backupDir,
    defaults: () => ({ assets: {} }),
    validate: raw => (raw && typeof raw === 'object' && (raw as any).assets && typeof (raw as any).assets === 'object') ? raw as any : null,
    logger
  });
  const statsStore = new JsonStore<StatsShape>({
    file: path.join(metaDir, 'statistics.json'), backupDir,
    defaults: () => ({ totalAssets: 0, totalBytes: 0, byCategory: {}, byExtension: {}, uploadsByDay: {}, downloadsByDay: {}, lastRebuildAt: null }),
    validate: raw => (raw && typeof raw === 'object' && typeof (raw as any).totalAssets === 'number') ? raw as any : null,
    logger
  });
  const activityStore = new JsonStore<{ entries: ActivityEntry[] }>({
    file: path.join(metaDir, 'activity.json'), backupDir,
    defaults: () => ({ entries: [] }),
    validate: raw => (raw && Array.isArray((raw as any).entries)) ? raw as any : null,
    logger
  });
  const usersStore = new JsonStore<{ users: Record<string, UserInfo> }>({
    file: path.join(metaDir, 'users.json'), backupDir,
    defaults: () => ({ users: {} }),
    validate: raw => (raw && typeof (raw as any).users === 'object') ? raw as any : null,
    logger
  });
  const keysStore = new JsonStore<{ keys: Record<string, ApiKeyInfo> }>({
    file: path.join(metaDir, 'apikeys.json'), backupDir,
    defaults: () => ({ keys: {} }),
    validate: raw => (raw && typeof (raw as any).keys === 'object') ? raw as any : null,
    logger
  });
  const s3Store = new JsonStore<{ creds: Record<string, S3Credential> }>({
    file: path.join(metaDir, 's3creds.json'), backupDir,
    defaults: () => ({ creds: {} }),
    validate: raw => (raw && typeof (raw as any).creds === 'object') ? raw as any : null,
    logger
  });
  const foldersStore = new JsonStore<{ folders: Record<string, { createdAt: string }> }>({
    file: path.join(metaDir, 'folders.json'), backupDir,
    defaults: () => ({ folders: {} }),
    validate: raw => (raw && typeof (raw as any).folders === 'object') ? raw as any : null,
    logger
  });
  const settingsStore = new JsonStore<{ settings: Record<string, unknown> }>({
    file: path.join(metaDir, 'settings.json'), backupDir,
    defaults: () => ({ settings: {} }),
    validate: raw => (raw && typeof (raw as any).settings === 'object') ? raw as any : null,
    logger
  });

  await Promise.all([
    assetsStore.init(), statsStore.init(), activityStore.init(), usersStore.init(),
    keysStore.init(), s3Store.init(), foldersStore.init(), settingsStore.init()
  ]);

  // Runtime settings overlay
  applyRuntimeSettings(config, settingsStore.snapshot.settings);

  // ── Domain objects ──────────────────────────────────────────────────────
  const layout = new Layout(await loadCategoriesConfig(config.categoriesFile));
  const adapter = new FsStorageAdapter(config.storageDir, layout);
  await adapter.init();

  const assets = new AssetsIndex(assetsStore, logger);
  assets.validateAndReindex();

  const stats = new StatsEngine(statsStore);
  const activity = new ActivityLog(activityStore);
  const users = new UsersRepo(usersStore);
  const apiKeys = new ApiKeysRepo(keysStore);
  const s3creds = new S3CredsRepo(s3Store);
  const folders = new FoldersRepo(foldersStore);
  const settings = new SettingsRepo(settingsStore);

  await users.seedAdmin(config.adminPassword);

  const bus = new EventBus();
  const queue = new JobQueue(config.workerConcurrency, logger, (type, payload, error) => {
    bus.emit('job.completed', { type, error: error?.message });
  });
  const limiter = new RateLimiter(config.rateLimitRpm);

  const ctx: AppContext = {
    config, layout, adapter, assets, stats, activity, users, apiKeys, s3creds,
    folders, settings,
    service: null as any, // wired below (needs ctx)
    uploads: new UploadSessionManager(path.join(config.storageDir, 'tmp'), undefined, 24 * 3600_000),
    queue, bus, limiter
  };
  ctx.service = new AssetsService(ctx);
  registerThumbnailJobs(ctx);

  // CDN hit tracking (batched metadata updates; serving never blocks on metadata)
  const tracker = new DownloadTracker(ctx);
  bus.on('cdn.hit', (p: any) => tracker.hit(p.relPath));

  // ── HTTP ────────────────────────────────────────────────────────────────
  const app = Fastify({
    logger: { level: config.logLevel, redact: ['req.headers.authorization', 'req.headers.cookie'] },
    bodyLimit: 2 * 1024 * 1024,
    trustProxy: true,
    disableRequestLogging: config.logLevel === 'silent'
  });
  app.decorate('mb', ctx);

  await app.register(cors, {
    origin: config.allowedOrigins.includes('*') ? true : config.allowedOrigins,
    exposedHeaders: ['ETag', 'Content-Range', 'Accept-Ranges', 'Content-Length'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'Range', 'If-None-Match']
  });
  await app.register(multipart, {
    limits: { fileSize: config.maxFileSize, files: 100, fields: 20 }
  });

  // Raw body streaming for chunk uploads
  app.addContentTypeParser('application/octet-stream', (_req, payload, done) => done(null, payload));
  app.addContentTypeParser('application/x-binary', (_req, payload, done) => done(null, payload));

  // Security headers for the dashboard
  app.addHook('onSend', async (req, reply) => {
    if (req.url.startsWith('/api') || req.url.startsWith('/cdn') || req.url.startsWith('/s3')) return;
    reply.header('Content-Security-Policy',
      "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'");
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
  });

  await app.register(fastifyStatic, { root: config.publicDir, index: ['index.html'] });

  registerHealthRoutes(app);
  registerAuthRoutes(app);
  registerAssetRoutes(app);
  registerUploadRoutes(app);
  registerCdnRoutes(app);
  registerMiscRoutes(app);
  registerAdminRoutes(app);
  registerDocs(app);
  if (config.s3Enabled) registerS3Routes(app);

  // Central error mapping for ApiError
  app.setErrorHandler((err, req, reply) => {
    const anyErr = err as any;
    const status = anyErr.statusCode ?? 500;
    if (status >= 500) req.log.error(err);
    reply.code(status).send({ error: anyErr.message ?? 'internal error' });
  });

  app.addHook('onClose', async () => {
    queue.close();
    await tracker.flush();
    await Promise.all([
      assetsStore.close(), statsStore.close(), activityStore.close(), usersStore.close(),
      keysStore.close(), s3Store.close(), foldersStore.close(), settingsStore.close()
    ]);
    logger.info('metadata stores flushed and closed');
  });

  logger.info(`MiniBucket ready (storage: ${config.storageDir}, assets indexed: ${assets.count()})`);
  void dayKeyUTC; // keep import for future use
  return app;
}