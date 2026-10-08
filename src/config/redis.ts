// ─── Redis Client ───────────────────────────────────────────────────────────
// One ioredis connection, reused everywhere: geospatial driver lookup
// (matching.service.ts), atomic ride-assignment locks, rate limiting, and as
// the connection BullMQ uses for the job queue. See matching.service.ts for
// why Redis (not Postgres) owns live driver location.
// ─────────────────────────────────────────────────────────────────────────────

import Redis from 'ioredis';
import { env } from './env';
import { logger } from './logger';

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null, // required by BullMQ when this connection is shared with it
});

redis.on('error', (err) => {
  logger.error({ err }, 'Redis connection error');
});

redis.on('connect', () => {
  logger.info('Connected to Redis');
});

// BullMQ needs its own connection options object (not a live client) in some
// setups, but ioredis instances are also accepted directly — we pass this
// same client to queues/workers to avoid opening redundant connections.
export const redisConnection = redis;

// A dedicated connection for Redis Pub/Sub. ioredis connections that call
// .subscribe() can no longer be used for normal commands, so pub/sub always
// needs its own client, separate from the one used for GEO/locks/etc.
export const redisSub = new Redis(env.REDIS_URL);
