// ─── Matching Service — Redis Geospatial Layer ────────────────────────────────
//
// WHY REDIS INSTEAD OF POSTGRES FOR "FIND NEARBY DRIVERS":
// Driver location changes constantly (every few seconds per active driver),
// and "find nearby available drivers" is a hot-path query that runs on
// every ride request. Doing this in Postgres would mean either:
//   (a) a full-table scan with Haversine math in SQL on every request, or
//   (b) a PostGIS geospatial index — which works, but still means writing
//       to a durable, WAL-logged, replicated table dozens of times a
//       second per driver, purely for data that's only ever "where is this
//       driver RIGHT NOW" — nobody queries "where was driver X two days
//       ago" from this table.
// Redis GEO commands (GEOADD/GEOSEARCH) are backed by a sorted set with
// O(log N) inserts and O(log N + M) radius queries, entirely in memory.
// It's the right tool for "ephemeral, high-frequency, read-hot spatial
// state" — which is exactly what live driver location is. Postgres stays
// the source of truth for the Driver row itself (status, id, relations);
// Redis is just a fast index over "who's near here right now."
// ─────────────────────────────────────────────────────────────────────────────

import { redis } from '../config/redis';
import { env } from '../config/env';
import { VehicleType } from '@prisma/client';
import { Coordinates, DriverCandidate } from '../types';

// One GEO set per vehicle type, so GEOSEARCH never has to post-filter by
// type in application code — "nearby AUTOs" and "nearby SUVs" are just two
// different sorted sets sharing the same coordinate data.
const geoKey = (vehicleType: VehicleType) => `drivers:geo:${vehicleType}`;

// Tiny metadata hash per online driver, so we can look up which geo set to
// remove them from without a round-trip to Postgres every time they go
// offline or get reserved for a ride.
const metaKey = (driverId: string) => `drivers:meta:${driverId}`;

export const matchingService = {
  /** Adds/updates a driver's live position in the pool for their vehicle type. */
  async addOrUpdateDriver(driverId: string, vehicleType: VehicleType, coords: Coordinates): Promise<void> {
    await redis
      .multi()
      .geoadd(geoKey(vehicleType), coords.longitude, coords.latitude, driverId)
      .hset(metaKey(driverId), { vehicleType })
      .exec();
  },

  /** Removes a driver from whichever geo set they're currently in (e.g. going OFFLINE/BUSY). */
  async removeDriver(driverId: string): Promise<void> {
    const meta = await redis.hgetall(metaKey(driverId));
    const vehicleType = meta.vehicleType as VehicleType | undefined;

    const multi = redis.multi();
    if (vehicleType) {
      multi.zrem(geoKey(vehicleType), driverId);
    } else {
      // Defensive: if we lost track of vehicleType, remove from every set.
      for (const vt of ['BIKE', 'AUTO', 'SEDAN', 'SUV'] as VehicleType[]) {
        multi.zrem(geoKey(vt), driverId);
      }
    }
    multi.del(metaKey(driverId));
    await multi.exec();
  },

  /**
   * Finds up to `maxCandidates` available drivers of the given vehicle type
   * within `radiusKm` of `pickup`, sorted nearest-first, excluding any
   * driverId in `excludeIds` (drivers who already declined/timed out for
   * this specific ride request).
   */
  async findNearbyDrivers(
    pickup: Coordinates,
    vehicleType: VehicleType,
    excludeIds: string[] = [],
    radiusKm = env.MATCHING_SEARCH_RADIUS_KM,
    maxCandidates = env.MATCHING_MAX_CANDIDATES
  ): Promise<DriverCandidate[]> {
    // ioredis's geosearch: FROMLONLAT lng lat BYRADIUS r km ASC COUNT n WITHCOORD WITHDIST
    const raw = (await redis.geosearch(
      geoKey(vehicleType),
      'FROMLONLAT',
      pickup.longitude,
      pickup.latitude,
      'BYRADIUS',
      radiusKm,
      'km',
      'ASC',
      'COUNT',
      maxCandidates + excludeIds.length, // over-fetch a bit since we filter afterward
      'WITHCOORD',
      'WITHDIST'
    )) as unknown as [string, string, [string, string]][];

    const excludeSet = new Set(excludeIds);

    return raw
      .filter(([driverId]) => !excludeSet.has(driverId))
      .slice(0, maxCandidates)
      .map(([driverId, distance, [longitude, latitude]]) => ({
        driverId,
        userId: '', // filled in by the caller if needed via a DB lookup — kept out of the hot path here
        distanceKm: parseFloat(distance),
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude),
      }));
  },

  // ─── Reservation lock: the core double-booking guard ─────────────────────
  //
  // THE PROBLEM: two riders could request a ride at nearly the same moment,
  // both find the same nearest driver as their #1 candidate, and both try
  // to offer that driver a ride. Without a lock, both requests could
  // proceed to "assign" the same driver.
  //
  // THE FIX: before offering a ride to a candidate driver, we try to take
  // an exclusive, time-limited reservation on that driver using Redis
  // `SET key value NX PX ttl`. NX ("set if Not eXists") + PX (millisecond
  // TTL) is atomic — Redis guarantees only one caller can ever succeed in
  // creating that key while it doesn't already exist, even under
  // concurrent requests from different Node processes. This is the same
  // primitive behind the classic "Redis distributed lock" pattern.
  //
  // If the reservation succeeds, we also immediately remove the driver
  // from the geo pool (see removeDriver above via matchingService in
  // ride.service.ts) so no OTHER ride request can even find them as a
  // candidate while they're being offered this one.
  //
  // If the driver doesn't respond in time, the reservation key naturally
  // expires (TTL), or we explicitly release it — either way, the driver
  // becomes matchable again.
  //
  // We ALSO re-check ride status atomically at the database layer in
  // ride.repository.ts's assignDriverIfMatching() (an UPDATE ... WHERE
  // status = 'MATCHING'). That's a second, independent safety net: even in
  // some pathological edge case where the Redis lock alone weren't
  // sufficient, Postgres would still refuse to double-assign a ride.
  // ─────────────────────────────────────────────────────────────────────────

  async reserveDriverForRide(driverId: string, rideId: string, ttlMs: number): Promise<boolean> {
    const result = await redis.set(`reserve:${driverId}`, rideId, 'PX', ttlMs, 'NX');
    return result === 'OK';
  },

  async releaseDriverReservation(driverId: string): Promise<void> {
    await redis.del(`reserve:${driverId}`);
  },

  async getRideOfferedToDriver(driverId: string): Promise<string | null> {
    return redis.get(`reserve:${driverId}`);
  },
};
