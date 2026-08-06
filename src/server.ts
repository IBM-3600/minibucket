import { buildApp } from './app.js';

async function main(): Promise<void> {
  const app = await buildApp();
  const config = app.mb.config;

  await app.listen({ port: config.port, host: config.host });

  const shutdown = async (signal: string) => {
    app.log.info(`${signal} received, shutting down gracefully…`);
    try { await app.close(); process.exit(0); }
    catch (err) { app.log.error(err); process.exit(1); }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});