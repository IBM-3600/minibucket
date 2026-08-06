import type { FastifyInstance } from 'fastify';
import { VERSION } from '../config.js';

export function registerHealthRoutes(app: FastifyInstance): void {
  app.get('/health', async () => ({
    status: 'ok',
    version: VERSION,
    uptimeSec: Math.floor(process.uptime()),
    time: new Date().toISOString(),
    assets: {
      totalAssets: app.mb.stats.get().totalAssets,
      totalBytes: app.mb.stats.get().totalBytes
    },
    queue: app.mb.queue.stats(),
    activeUploadSessions: app.mb.uploads.activeCount
  }));
}