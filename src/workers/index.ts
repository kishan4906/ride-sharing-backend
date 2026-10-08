import { createRideMatchingWorker } from './ride-matching.worker';
import { logger } from '../config/logger';

const worker = createRideMatchingWorker();

logger.info('🚕 Ride-matching worker started, listening for jobs...');

async function shutdown() {
  logger.info('Worker shutting down...');
  await worker.close();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
