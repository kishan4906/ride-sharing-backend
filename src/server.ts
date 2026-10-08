import { createServer } from 'http';
import { createApp } from './app';
import { initSockets } from './sockets';
import { env } from './config/env';
import { logger } from './config/logger';
import { prisma } from './config/db';
import { redis } from './config/redis';

const app = createApp();
const httpServer = createServer(app);
const io = initSockets(httpServer);

httpServer.listen(env.PORT, () => {
  logger.info(`🚀 API listening on port ${env.PORT} (${env.NODE_ENV})`);
  logger.info(`📚 Swagger docs at http://localhost:${env.PORT}/api/docs`);
});

async function shutdown(signal: string) {
  logger.info(`${signal} received — shutting down gracefully...`);
  io.close();
  httpServer.close(async () => {
    await prisma.$disconnect();
    redis.disconnect();
    logger.info('Shutdown complete');
    process.exit(0);
  });

  // Force-exit if graceful shutdown hangs
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection');
});
