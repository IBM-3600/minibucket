import type { Layout } from './storage/layout.js';
import type { StorageAdapter } from './storage/adapter.js';
import type { AssetsIndex } from './metadata/assets-index.js';
import type { StatsEngine } from './metadata/stats-engine.js';
import type { ActivityLog } from './metadata/activity-log.js';
import type { UsersRepo } from './metadata/users.js';
import type { ApiKeysRepo } from './metadata/api-keys.js';
import type { S3CredsRepo } from './metadata/s3-creds.js';
import type { FoldersRepo } from './metadata/folders.js';
import type { SettingsRepo } from './metadata/settings.js';
import type { AssetsService } from './services/assets-service.js';
import type { UploadSessionManager } from './services/upload-sessions.js';
import type { JobQueue } from './workers/queue.js';
import type { EventBus } from './lib/event-bus.js';
import type { RateLimiter } from './lib/rate-limiter.js';
import type { AppConfig } from './config.js';
export {AppConfig}
export type Role = 'admin' | 'editor' | 'uploader' | 'viewer';
export type NamingStrategy = 'hash' | 'timestamp' | 'uuid';
export type Scope = 'read' | 'write' | 'delete' | 'admin';

export interface AssetRecord {
  id: string;
  originalName: string;
  storedName: string;
  extension: string;
  category: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  etag: string;
  relativePath: string;
  publicUrl: string;
  thumbnail: string | null;
  folder: string;
  source: 'ui' | 'api' | 's3' | 'rebuild';
  uploadedBy: string;
  uploadedAt: string;
  updatedAt: string;
  downloads: number;
  lastAccess: string | null;
  cacheControl: string;
  tags: string[];
  versions: { storedName: string; uploadedAt: string; sizeBytes: number }[];
  deletedAt: string | null;
}

export interface ListAssetsQuery {
  q?: string;
  category?: string;
  tag?: string;
  mime?: string;
  ext?: string;
  folder?: string;
  from?: string;
  to?: string;
  minSize?: number;
  maxSize?: number;
  sort?: 'uploadedAt' | 'sizeBytes' | 'originalName' | 'downloads';
  order?: 'asc' | 'desc';
  page?: number;
  perPage?: number;
  trashed?: boolean;
}

export interface UserInfo {
  id: string;
  username: string;
  role: Role;
  passwordHash: string;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface ApiKeyInfo {
  id: string;
  name: string;
  keyHash: string;
  prefix: string;
  role: Role;
  scopes: Scope[];
  expiresAt: string | null;
  rateLimitRpm: number | null;
  ipAllowlist: string[];
  createdAt: string;
  lastUsedAt: string | null;
  revoked: boolean;
}

export interface S3Credential {
  accessKeyId: string;
  secretAccessKey: string;
  label: string;
  createdAt: string;
}

export interface ActivityEntry {
  id: string;
  ts: string;
  actor: string;
  action: string;
  target?: string;
  detail?: string;
}

export interface StatsShape {
  totalAssets: number;
  totalBytes: number;
  byCategory: Record<string, number>;
  byExtension: Record<string, number>;
  uploadsByDay: Record<string, number>;
  downloadsByDay: Record<string, number>;
  lastRebuildAt: string | null;
}

export interface AuthInfo {
  kind: 'user' | 'apikey';
  role: Role;
  username?: string;
  userId?: string;
  keyId?: string;
  scopes?: Scope[];
  subject: string;
}

export interface AppContext {
  config: AppConfig;
  layout: Layout;
  adapter: StorageAdapter;
  assets: AssetsIndex;
  stats: StatsEngine;
  activity: ActivityLog;
  users: UsersRepo;
  apiKeys: ApiKeysRepo;
  s3creds: S3CredsRepo;
  folders: FoldersRepo;
  settings: SettingsRepo;
  service: AssetsService;
  uploads: UploadSessionManager;
  queue: JobQueue;
  bus: EventBus;
  limiter: RateLimiter;
}

declare module 'fastify' {
  interface FastifyInstance {
    mb: AppContext;
  }
  interface FastifyRequest {
    auth: AuthInfo;
  }
}