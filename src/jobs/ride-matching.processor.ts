// ─── Ride Matching Job Processor ───────────────────────────────────────────
// This is where requirement #9 ("driver matching algorithm") and the
// concurrency-safety requirements actually live. It runs inside the BullMQ
// worker (src/workers/ride-matching.worker.ts), NOT inside the HTTP request
// that created the ride — see ride.service.createRide for why.
//
// ALGORITHM (per attempt):
//   1. Load the ride. If it's no longer MATCHING (cancelled, or somehow
//      already assigned), stop — nothing to do.
//   2. Ask Redis GEO for nearby AVAILABLE drivers of the right vehicle type
//      (see matching.service.ts), excluding anyone who already declined/
//      timed out for this ride.
//   3. Rank candidates by distance (GEOSEARCH already returns them sorted
//      ASC by distance — see matching.service.ts's use of the ASC flag).
//      A real system might also weight in driver rating here; this project
//      keeps ranking to distance alone and calls that out as a
//      simplification rather than pretending otherwise.
//   4. Walk the ranked list and try to RESERVE the first driver (atomic
//      Redis SET-NX lock, see matching.service.ts). This is the step that
//      prevents two concurrent ride requests from offering the same driver
//      at the same moment — only one caller's reserve() can ever succeed.
//   5. On a successful reservation: pull the driver out of the geo pool (so
//      they can't be found as a candidate for ANY other ride while this
//      offer is pending), emit `ride:request` to that driver's socket room,
//      and schedule an offer-timeout job for 15s later.
//   6. If no candidate could be reserved (empty candidate list, or every
//      reserve() attempt lost the race to a concurrent request): either
//      retry with a short delay, or — after MAX_MATCH_ATTEMPTS — give up
//      and mark the ride NO_DRIVERS_FOUND.
// ─────────────────────────────────────────────────────────────────────────────

import { rideRepository } from '../repositories/ride.repository';
import { driverRepository } from '../repositories/driver.repository';
import { matchingService } from '../services/matching.service';
import { publishSocketEvent, rooms } from '../sockets/emitter';
import { enqueueFindAndOffer, enqueueOfferTimeout, MAX_MATCH_ATTEMPTS, FindAndOfferJobData, OfferTimeoutJobData } from './queues';
import { logger } from '../config/logger';

const NO_CANDIDATE_RETRY_DELAY_MS = 3_000;
const OFFER_WINDOW_MS = 15_000;

export async function processFindAndOffer(data: FindAndOfferJobData): Promise<void> {
  const { rideId, excludedDriverIds, attempt } = data;

  const ride = await rideRepository.findById(rideId);
  if (!ride || ride.status !== 'MATCHING') {
    logger.info({ rideId, status: ride?.status }, 'find-and-offer: ride no longer matching, skipping');
    return;
  }

  const candidates = await matchingService.findNearbyDrivers(
    { latitude: ride.pickupLatitude, longitude: ride.pickupLongitude },
    ride.vehicleType,
    excludedDriverIds
  );

  logger.info({ rideId, attempt, candidateCount: candidates.length }, 'find-and-offer: candidates found');

  for (const candidate of candidates) {
    const reserved = await matchingService.reserveDriverForRide(candidate.driverId, rideId, OFFER_WINDOW_MS);
    if (!reserved) continue; // lost the race to a concurrent ride request — try the next candidate

    // Successfully reserved — pull them out of the pool so nobody else can
    // find them as a candidate while this offer is pending.
    await matchingService.removeDriver(candidate.driverId);

    await publishSocketEvent(rooms.driver(candidate.driverId), 'ride:request', {
      rideId: ride.id,
      pickup: { latitude: ride.pickupLatitude, longitude: ride.pickupLongitude },
      destination: { latitude: ride.destinationLatitude, longitude: ride.destinationLongitude },
      vehicleType: ride.vehicleType,
      estimatedFare: ride.estimatedFare,
      estimatedDistance: ride.estimatedDistance,
      distanceToPickupKm: candidate.distanceKm,
      offerExpiresInMs: OFFER_WINDOW_MS,
    });

    await enqueueOfferTimeout(rideId, candidate.driverId, excludedDriverIds, attempt);
    return; // one active offer at a time — done for this attempt
  }

  // No candidate available or every reservation attempt lost its race.
  if (attempt >= MAX_MATCH_ATTEMPTS) {
    const updatedCount = await rideRepository.transitionStatus(rideId, ['MATCHING'], 'NO_DRIVERS_FOUND');
    if (updatedCount > 0) {
      await rideRepository.addEvent(rideId, 'NO_DRIVERS_FOUND', { attempts: attempt });
      await publishSocketEvent(rooms.rider(ride.riderId), 'ride:no-drivers', { rideId });
      await publishSocketEvent(rooms.ride(rideId), 'ride:no-drivers', { rideId });
    }
    return;
  }

  await enqueueFindAndOffer(rideId, excludedDriverIds, attempt + 1, NO_CANDIDATE_RETRY_DELAY_MS);
}

export async function processOfferTimeout(data: OfferTimeoutJobData): Promise<void> {
  const { rideId, driverId, excludedDriverIds, attempt } = data;

  const ride = await rideRepository.findById(rideId);
  if (!ride || ride.status !== 'MATCHING') {
    // Ride was accepted (moved to DRIVER_ASSIGNED) or cancelled in the
    // meantime — this timeout is moot. NOTE: we deliberately do NOT release
    // the reservation here if the ride was accepted, since acceptRide()
    // already released it as part of confirming the assignment.
    return;
  }

  logger.info({ rideId, driverId }, 'offer-timeout: driver did not respond in time, moving to next candidate');

  await matchingService.releaseDriverReservation(driverId);

  // Put the driver back in the pool, but only if they're still genuinely
  // AVAILABLE in Postgres (they might have gone offline while their offer
  // was pending).
  const driver = await driverRepository.findById(driverId);
  if (driver?.status === 'AVAILABLE' && driver.vehicle && driver.currentLatitude != null && driver.currentLongitude != null) {
    await matchingService.addOrUpdateDriver(driverId, driver.vehicle.vehicleType, {
      latitude: driver.currentLatitude,
      longitude: driver.currentLongitude,
    });
  }

  await publishSocketEvent(rooms.driver(driverId), 'ride:request-expired', { rideId });

  await enqueueFindAndOffer(rideId, [...excludedDriverIds, driverId], attempt); // same attempt count — this is "retry within the attempt", the outer attempt counter is for "no candidates at all" rounds
}
