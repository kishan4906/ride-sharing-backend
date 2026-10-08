// ─── Background Job Queues (BullMQ) ────────────────────────────────────────
// One queue, two job types, processed by one worker (src/workers/). Kept as
// a single queue because both job types operate on the same "drive a ride
// to a matched driver" workflow and share retry/backoff needs — splitting
// into multiple queues would just mean coordinating across them for no
// real benefit at this scale.
// ─────────────────────────────────────────────────────────────────────────────

import { Queue } from 'bullmq';
import { redisConnection } from '../config/redis';

export const RIDE_MATCHING_QUEUE = 'ride-matching';

export type FindAndOfferJobData = {
  type: 'find-and-offer';
  rideId: string;
  excludedDriverIds: string[];
  attempt: number;
};

export type OfferTimeoutJobData = {
  type: 'offer-timeout';
  rideId: string;
  driverId: string;
  excludedDriverIds: string[];
  attempt: number;
};

export type RideMatchingJobData = FindAndOfferJobData | OfferTimeoutJobData;

export const rideMatchingQueue = new Queue<RideMatchingJobData>(RIDE_MATCHING_QUEUE, {
  connection: redisConnection,
  defaultJobOptions: {
    removeOnComplete: { age: 3600 }, // keep completed jobs for 1h for debugging, then drop
    removeOnFail: { age: 86400 }, // keep failed jobs for 24h — worth investigating
  },
});

const MAX_MATCH_ATTEMPTS = 5;
const OFFER_TIMEOUT_MS = 15_000;

export async function enqueueFindAndOffer(
  rideId: string,
  excludedDriverIds: string[] = [],
  attempt = 1,
  delayMs = 0
) {
  if (attempt > MAX_MATCH_ATTEMPTS) return; // ride.service marks NO_DRIVERS_FOUND before this is ever hit
  await rideMatchingQueue.add(
    'find-and-offer',
    { type: 'find-and-offer', rideId, excludedDriverIds, attempt },
    {
      attempts: 1, // retries of "no candidate found right now" are modeled explicitly via `attempt`, not BullMQ's own retry
      delay: delayMs,
      jobId: `find-and-offer:${rideId}:${attempt}`, // idempotency: never double-enqueue the same attempt
    }
  );
}

export async function enqueueOfferTimeout(
  rideId: string,
  driverId: string,
  excludedDriverIds: string[],
  attempt: number
) {
  await rideMatchingQueue.add(
    'offer-timeout',
    { type: 'offer-timeout', rideId, driverId, excludedDriverIds, attempt },
    {
      delay: OFFER_TIMEOUT_MS,
      jobId: `offer-timeout:${rideId}:${driverId}`,
    }
  );
}

export { MAX_MATCH_ATTEMPTS, OFFER_TIMEOUT_MS };
