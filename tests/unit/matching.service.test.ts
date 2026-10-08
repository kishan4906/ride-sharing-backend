// ─── matchingService — reservation lock ─────────────────────────────────────
// This part of the file is exercised against ioredis-mock, which DOES
// support plain SET/GET/DEL — so the double-booking guard (the most
// safety-critical logic in this project) is genuinely tested below, not
// just described.
//
// The geo-pool methods (addOrUpdateDriver / findNearbyDrivers / removeDriver)
// use Redis GEOADD/GEOSEARCH, which ioredis-mock does not implement at all
// (confirmed directly — it throws "Unsupported command: geoadd"). Testing
// those against a real Redis instance is covered separately in
// tests/integration/matching.geo.test.ts, which requires docker-compose's
// Redis to be running — see that file for how to run it.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, vi } from 'vitest';
import RedisMock from 'ioredis-mock';

const mockRedis = new RedisMock();
vi.mock('../../src/config/redis', () => ({
  redis: mockRedis,
  redisConnection: mockRedis,
  redisSub: mockRedis,
}));

const { matchingService } = await import('../../src/services/matching.service');

beforeEach(async () => {
  await mockRedis.flushall();
});

describe('matchingService — reservation lock (the double-booking guard)', () => {
  it('allows the first reservation attempt to succeed', async () => {
    const ok = await matchingService.reserveDriverForRide('driver-4', 'ride-A', 5000);
    expect(ok).toBe(true);
  });

  it('CRITICAL: rejects a second reservation attempt for the same driver while the first is active', async () => {
    // This is the core concurrency guarantee this whole project depends on:
    // two "ride requests" trying to reserve the same driver at the same
    // time — only one must win.
    const first = await matchingService.reserveDriverForRide('driver-5', 'ride-A', 5000);
    const second = await matchingService.reserveDriverForRide('driver-5', 'ride-B', 5000);

    expect(first).toBe(true);
    expect(second).toBe(false); // ride-B must NOT be able to also claim driver-5
  });

  it('simulates the actual race: many concurrent reservation attempts for one driver, exactly one wins', async () => {
    const attempts = Array.from({ length: 20 }, (_, i) =>
      matchingService.reserveDriverForRide('driver-contested', `ride-${i}`, 5000)
    );
    const results = await Promise.all(attempts);
    const successCount = results.filter(Boolean).length;

    expect(successCount).toBe(1); // out of 20 simultaneous attempts, exactly one may succeed
  });

  it('releases the reservation so the driver becomes reservable again', async () => {
    await matchingService.reserveDriverForRide('driver-6', 'ride-C', 5000);
    await matchingService.releaseDriverReservation('driver-6');

    const reReserved = await matchingService.reserveDriverForRide('driver-6', 'ride-D', 5000);
    expect(reReserved).toBe(true);
  });

  it('getRideOfferedToDriver reflects the current reservation', async () => {
    await matchingService.reserveDriverForRide('driver-7', 'ride-E', 5000);
    const offered = await matchingService.getRideOfferedToDriver('driver-7');
    expect(offered).toBe('ride-E');
  });
});
