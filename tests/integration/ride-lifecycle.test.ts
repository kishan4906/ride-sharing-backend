// ─── Full ride lifecycle integration test ──────────────────────────────────
// This is the most valuable test in the project: it exercises rider
// registration, driver registration + going online, ride creation, the
// BACKGROUND MATCHING WORKER actually finding and offering the ride,
// accept, and every lifecycle transition through to completion + payment.
//
// Requires the FULL stack: Postgres, Redis, AND a running worker process
// (or this test spins up its own worker instance in-process — see below).
//
//   docker-compose up -d postgres redis
//   npx prisma migrate deploy
//   npx vitest run tests/integration/ride-lifecycle.test.ts
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { createRideMatchingWorker } from '../../src/workers/ride-matching.worker';
import { redis } from '../../src/config/redis';

const app = createApp();
const suffix = Date.now();

const rider = {
  name: 'Lifecycle Rider',
  email: `lifecycle-rider-${suffix}@example.com`,
  phone: `+91911111${suffix % 10000}`,
  password: 'RiderPass123!',
  role: 'RIDER' as const,
};

const driver = {
  name: 'Lifecycle Driver',
  email: `lifecycle-driver-${suffix}@example.com`,
  phone: `+91922222${suffix % 10000}`,
  password: 'DriverPass123!',
  role: 'DRIVER' as const,
};

let riderToken: string;
let driverToken: string;
let rideId: string;

describe('Full ride lifecycle', () => {
  let worker: ReturnType<typeof createRideMatchingWorker>;

  beforeAll(async () => {
    // This test needs the matching worker actually running to process the
    // ride it creates — in production that's a separate `npm run worker`
    // process; here we start one in-process so the test is self-contained.
    worker = createRideMatchingWorker();

    const riderRes = await request(app).post('/api/v1/auth/register').send(rider);
    riderToken = riderRes.body.data.token;

    const driverRes = await request(app).post('/api/v1/auth/register').send(driver);
    driverToken = driverRes.body.data.token;

    await request(app)
      .post('/api/v1/drivers/register')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ vehicleType: 'SEDAN', make: 'Honda', model: 'City', licensePlate: `TEST${suffix}`, color: 'White' });

    // Driver must set a location before going AVAILABLE
    await request(app)
      .patch('/api/v1/drivers/location')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ latitude: 22.3072, longitude: 73.1812 });

    await request(app)
      .patch('/api/v1/drivers/status')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ status: 'AVAILABLE' });
  });

  afterAll(async () => {
    await worker.close();
  });

  it('rider creates a ride, which starts MATCHING', async () => {
    const res = await request(app)
      .post('/api/v1/rides')
      .set('Authorization', `Bearer ${riderToken}`)
      .send({
        pickup: { latitude: 22.308, longitude: 73.182 }, // near the driver's seeded location
        destination: { latitude: 22.322, longitude: 73.168 },
        vehicleType: 'SEDAN',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('MATCHING');
    expect(res.body.data.estimatedFare).toBeGreaterThan(0);
    rideId = res.body.data.rideId;
  });

  it('the background worker matches the ride to the available driver', async () => {
    // The worker processes the find-and-offer job asynchronously — poll
    // briefly for the reservation to appear rather than asserting instantly.
    let offered: string | null = null;
    for (let i = 0; i < 20; i++) {
      offered = await redis.get(`reserve:${await getDriverId()}`);
      if (offered) break;
      await sleep(250);
    }
    expect(offered).toBe(rideId);
  });

  it('driver accepts the ride, moving it to DRIVER_ASSIGNED', async () => {
    const res = await request(app)
      .post(`/api/v1/rides/${rideId}/accept`)
      .set('Authorization', `Bearer ${driverToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('DRIVER_ASSIGNED');
  });

  it('rejects a second accept attempt on the same ride (idempotency / concurrency guard)', async () => {
    const res = await request(app)
      .post(`/api/v1/rides/${rideId}/accept`)
      .set('Authorization', `Bearer ${driverToken}`);
    expect(res.status).toBe(409); // already assigned, and no longer "offered" to this driver either
  });

  it('walks through arriving → arrived → start → complete', async () => {
    const arriving = await request(app)
      .post(`/api/v1/rides/${rideId}/arriving`)
      .set('Authorization', `Bearer ${driverToken}`);
    expect(arriving.status).toBe(200);
    expect(arriving.body.data.status).toBe('DRIVER_ARRIVING');

    const arrived = await request(app)
      .post(`/api/v1/rides/${rideId}/arrived`)
      .set('Authorization', `Bearer ${driverToken}`);
    expect(arrived.status).toBe(200);
    expect(arrived.body.data.status).toBe('DRIVER_ARRIVED');

    const started = await request(app)
      .post(`/api/v1/rides/${rideId}/start`)
      .set('Authorization', `Bearer ${driverToken}`);
    expect(started.status).toBe(200);
    expect(started.body.data.status).toBe('IN_PROGRESS');

    const completed = await request(app)
      .post(`/api/v1/rides/${rideId}/complete`)
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ paymentMethod: 'CASH' });
    expect(completed.status).toBe(200);
    expect(completed.body.data.status).toBe('COMPLETED');
    expect(completed.body.data.finalFare).toBeGreaterThan(0);
    expect(completed.body.data.payment.status).toBe('COMPLETED');
  });

  it('rejects an invalid state transition (e.g. starting a completed ride again)', async () => {
    const res = await request(app)
      .post(`/api/v1/rides/${rideId}/start`)
      .set('Authorization', `Bearer ${driverToken}`);
    expect(res.status).toBe(409); // COMPLETED → IN_PROGRESS is not a valid transition
  });

  it('rider can rate the completed ride', async () => {
    const res = await request(app)
      .post(`/api/v1/rides/${rideId}/rating`)
      .set('Authorization', `Bearer ${riderToken}`)
      .send({ rating: 5, comment: 'Smooth ride' });
    expect(res.status).toBe(201);
    expect(res.body.data.rating).toBe(5);
  });

  it('rejects rating the same ride twice', async () => {
    const res = await request(app)
      .post(`/api/v1/rides/${rideId}/rating`)
      .set('Authorization', `Bearer ${riderToken}`)
      .send({ rating: 3 });
    expect(res.status).toBe(409);
  });

  it("a driver cannot view another driver's ride they weren't assigned to", async () => {
    const otherDriverEmail = `other-driver-${suffix}@example.com`;
    const otherDriverRes = await request(app).post('/api/v1/auth/register').send({
      name: 'Other Driver',
      email: otherDriverEmail,
      phone: `+91933333${suffix % 10000}`,
      password: 'OtherPass123!',
      role: 'DRIVER',
    });
    const otherToken = otherDriverRes.body.data.token;

    const res = await request(app).get(`/api/v1/rides/${rideId}`).set('Authorization', `Bearer ${otherToken}`);
    expect(res.status).toBe(403);
  });
});

async function getDriverId(): Promise<string> {
  // Small helper: the driver's Driver.id (not User.id) is what reservation
  // keys are keyed by — fetch it via /auth/me → driver.id.
  const res = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${driverToken}`);
  return res.body.data.driver.id;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
