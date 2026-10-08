import { Worker } from 'bullmq';
import { redisConnection } from '../config/redis';
import { RIDE_MATCHING_QUEUE, RideMatchingJobData } from '../jobs/queues';
import { processFindAndOffer, processOfferTimeout } from '../jobs/ride-matching.processor';
import { logger } from '../config/logger';

export function createRideMatchingWorker(): Worker<RideMatchingJobData> {
  const worker = new Worker<RideMatchingJobData>(
    RIDE_MATCHING_QUEUE,
    async (job) => {
      switch (job.data.type) {
        case 'find-and-offer':
          return processFindAndOffer(job.data);
        case 'offer-timeout':
          return processOfferTimeout(job.data);
        default:
          logger.warn({ job: job.data }, 'Unknown ride-matching job type');
      }
    },
    {
      connection: redisConnection,
      concurrency: 10, // several rides can be matched in parallel; each job is short-lived
    }
  );

  worker.on('completed', (job) => {
    logger.debug({ jobId: job.id, type: job.data.type }, 'ride-matching job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, type: job?.data.type, err }, 'ride-matching job failed');
  });

  return worker;
}
