import 'dotenv/config';
import path from 'node:path';
import type { AppConfig } from './types.js';

function bool(v: string | undefined, dflt: boolean): boolean {
  if (v === undefined || v === '') return dflt;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}
function int(v: string | undefined, dflt: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : dflt;
}

export const VERSION = '1.0.0';

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const env = process.env;
  const config: AppConfig = {
    port: int(env.PORT, 8080),
    host: env.HOST ?? '0.0.0.0',
    storageDir: path.resolve(env.STORAGE_DIR ?? './data'),
    publicDir: path.resolve(env.PUBLIC_DIR ?? './public'),
    categoriesFile: env.CATEGORIES_FILE ? path.resolve(env.CATEGORIES_FILE) : path.resolve('./config/categories.json'),
    jwtSecret: env.JWT_SECRET ?? 'dev-insecure-secret-change-me',
    adminPassword: env.ADMIN_PASSWORD ?? env.UI_PASSWORD ?? 'admin',
    maxFileSize: int(env.MAX_FILE_SIZE, 5 * 1024 * 1024 * 1024),
    maxChunkSize: int(env.MAX_CHUNK_SIZE, 16 * 1024 * 1024),
    cdnMaxAge: int(env.CDN_MAX_AGE, 31536000),
    allowedOrigins: (env.ALLOWED_ORIGINS ?? '*').split(',').map(s => s.trim()).filter(Boolean),
    dedupe: bool(env.DEDUPE, true),
    namingStrategy: (env.NAMING_STRATEGY as AppConfig['namingStrategy']) ?? 'hash',
    thumbnailEnabled: bool(env.THUMBNAIL_ENABLED, true),
    enableWebsockets: bool(env.ENABLE_WEBSOCKETS, false),
    logLevel: env.LOG_LEVEL ?? 'info',
     logFile: env.LOG_FILE && env.LOG_FILE.trim()
      ? path.resolve(env.LOG_FILE)
      : null,
    s3Enabled: bool(env.S3_COMPAT_ENABLED, false),
    s3Bucket: env.S3_BUCKET ?? 'assets',
    s3Region: env.S3_REGION ?? 'us-east-1',
    rateLimitRpm: int(env.RATE_LIMIT_RPM, 600),
    workerConcurrency: int(env.WORKER_CONCURRENCY, 2),
    ...overrides
  };
  const namingStrategy = typeof config.namingStrategy === 'string' ? config.namingStrategy : 'hash';
  if (!['hash', 'timestamp', 'uuid'].includes(namingStrategy)) config.namingStrategy = 'hash';
  else config.namingStrategy = namingStrategy as AppConfig['namingStrategy'];
  return config;
}

/** Apply persisted runtime settings (from Settings page) over env-derived config. */
export function applyRuntimeSettings(config: AppConfig, settings: Record<string, unknown>): AppConfig {
  if (typeof settings.dedupe === 'boolean') config.dedupe = settings.dedupe;
  if (typeof settings.thumbnailEnabled === 'boolean') config.thumbnailEnabled = settings.thumbnailEnabled;
  if (settings.namingStrategy === 'hash' || settings.namingStrategy === 'timestamp' || settings.namingStrategy === 'uuid') {
    config.namingStrategy = settings.namingStrategy;
  }
  return config;
}