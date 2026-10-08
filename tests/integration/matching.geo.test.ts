// ─── Integration test: Redis geo pool ──────────────────────────────────────
// ioredis-mock (used in tests/unit/matching.service.test.ts) does not
// implement GEOADD/GEOSEARCH at all, so the geo-pool half of
// matching.service.ts can only be verified against a REAL Redis instance.
//
// Run with Redis available (e.g. `docker-compose up -d redis`), pointing
// REDIS_URL at it — .env.test's default (redis://localhost:6379/1) assumes
// docker-compose's default port mapping and uses DB 1 to avoid colliding
// with anything on DB 0.
//
//   docker-compose up -d redis
//   npx vitest run tests/integration/matching.geo.test.ts
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { matchingService } from '../../src/services/matching.service';
import { redis } from '../../src/config/redis';

const VADODARA = { latitude: 22.3072, longitude: 73.1812 };
const NEARBY = { latitude: 22.31, longitude: 73.185 };
const FAR_AWAY = { latitude: 12.9716, longitude: 77.5946 }; // Bangalore

beforeEach(async () => {
  await redis.flushdb();
});

afterAll(async () => {
  await redis.flushdb();
  redis.disconnect();
});

describe('matchingService — geo pool (requires real Redis)', () => {
  it('finds a driver added to the pool, within radius', async () => {
    await matchingService.addOrUpdateDriver('driver-1', 'SEDAN', NEARBY);
    const results = await matchingService.findNearbyDrivers(VADODARA, 'SEDAN', [], 10, 10);
    expect(results.map((r) => r.driverId)).toContain('driver-1');
  });

  it('does not return a driver outside the search radius', async () => {
    await matchingService.addOrUpdateDriver('driver-far', 'SEDAN', FAR_AWAY);
    const results = await matchingService.findNearbyDrivers(VADODARA, 'SEDAN', [], 5, 10);
    expect(results.map((r) => r.driverId)).not.toContain('driver-far');
  });

  it('does not return a driver of a different vehicle type', async () => {
    await matchingService.addOrUpdateDriver('driver-bike', 'BIKE', NEARBY);
    const results = await matchingService.findNearbyDrivers(VADODARA, 'SEDAN', [], 10, 10);
    expect(results.map((r) => r.driverId)).not.toContain('driver-bike');
  });

  it('sorts candidates nearest-first', async () => {
    await matchingService.addOrUpdateDriver('driver-close', 'SEDAN', { latitude: 22.308, longitude: 73.182 });
    await matchingService.addOrUpdateDriver('driver-mid', 'SEDAN', { latitude: 22.33, longitude: 73.2 });
    const results = await matchingService.findNearbyDrivers(VADODARA, 'SEDAN', [], 20, 10);
    const ids = results.map((r) => r.driverId);
    expect(ids.indexOf('driver-close')).toBeLessThan(ids.indexOf('driver-mid'));
  });

  it('removeDriver takes them out of the pool entirely', async () => {
    await matchingService.addOrUpdateDriver('driver-3', 'SUV', NEARBY);
    await matchingService.removeDriver('driver-3');
    const results = await matchingService.findNearbyDrivers(VADODARA, 'SUV', [], 10, 10);
    expect(results.map((r) => r.driverId)).not.toContain('driver-3');
  });
});
