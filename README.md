# Ride-Sharing Backend API

A simplified, production-style Uber/Ola-like ride-sharing backend — built as a
backend-architecture learning project. It's not a toy: real JWT auth, a real
Postgres schema with proper indexes and atomic state transitions, real Redis
geospatial driver matching, real Socket.IO real-time updates, and a real
background job queue (BullMQ) driving the matching algorithm. But it's also
not pretending to be Uber's actual system — every simplification is called
out explicitly in comments and in the "Known simplifications" section below.

## Tech stack

| Layer | Choice |
|---|---|
| Language | TypeScript (Node.js) |
| HTTP framework | Express |
| Database | PostgreSQL via Prisma ORM |
| Cache / geospatial / ephemeral state | Redis (ioredis) |
| Real-time | Socket.IO |
| Background jobs | BullMQ (Redis-backed) |
| Auth | JWT + Argon2id password hashing |
| Validation | Zod |
| Testing | Vitest + Supertest |
| API docs | Swagger / OpenAPI (swagger-jsdoc + swagger-ui-express) |
| Infra | Docker + Docker Compose |

---

## Quick start (Docker — recommended)

This brings up Postgres, Redis, the API, and the background worker, runs
migrations, and seeds sample data, all in one command:

```bash
cp .env.example .env
docker-compose up --build
```

- API: http://localhost:4000
- Swagger docs: http://localhost:4000/api/docs
- Health check: http://localhost:4000/health

Seeded accounts (password for all of them: `Password123!`):
- Riders: `rider1@demo.com` .. `rider3@demo.com`
- Drivers: `driver1@demo.com` .. `driver5@demo.com` (seeded near Vadodara, Gujarat)
- Admin: `admin@demo.com`

**Important**: seeding sets drivers `AVAILABLE` in Postgres, but the Redis geo
pool is runtime-only and isn't pre-populated by the seed script (Redis holds
ephemeral state, not seed data — see "Why Redis for driver location" below).
After logging a seeded driver in, call `PATCH /drivers/status` with
`{"status": "AVAILABLE"}` once to actually enter them into the matching pool.

## Manual local setup (without Docker)

```bash
npm install
cp .env.example .env   # edit DATABASE_URL / REDIS_URL if not using Docker's defaults

npx prisma migrate dev --name init
npm run seed

# Terminal 1
npm run dev

# Terminal 2 — the background matching worker is a SEPARATE process
npm run worker
```

The worker is not optional — ride matching happens entirely inside it (see
"Why matching runs in a background job" below). Without it running, rides
will sit in `MATCHING` forever.

## Testing

```bash
npm test                   # pure-logic unit tests — no infra needed, runs anywhere
npm run test:integration   # requires Postgres + Redis running (docker-compose up -d postgres redis)
npm run test:all           # both
```

`tests/unit/` covers fare calculation, geo distance math, and — using
`ioredis-mock` — the Redis reservation-lock concurrency logic (including a
test that fires 20 simultaneous reservation attempts at the same driver and
asserts exactly one wins, which is the core safety property this whole
project depends on). `ioredis-mock` doesn't implement Redis's GEO commands,
so the geo-pool lookup logic itself is tested separately in
`tests/integration/matching.geo.test.ts` against a real Redis. `tests/integration/`
also covers the full auth flow and a complete ride lifecycle end-to-end,
including the background worker actually matching a ride.

---

## Project structure

```
src/
├── config/        env, Prisma client singleton, Redis client, logger
├── errors/        AppError hierarchy (BadRequestError, NotFoundError, etc.)
├── types/         shared TS types (AuthenticatedUser, Coordinates, ...)
├── utils/         password hashing, JWT, Haversine distance, asyncHandler
├── validators/    Zod schemas per domain (auth, ride, driver)
├── middleware/    auth, role guard, Zod validation, error handler, rate limiter
├── repositories/  Prisma queries ONLY — no business logic
├── services/      business logic — auth, driver, ride, matching, fare, payment
├── controllers/   thin HTTP layer — parse req, call service, shape response
├── routes/        Express routers + Swagger JSDoc annotations
├── sockets/       Socket.IO bootstrap, auth, room management, Redis pub/sub bridge
├── jobs/          BullMQ queue definitions + the matching job processor
├── workers/       the worker process entrypoint (separate from the API process)
├── docs/          Swagger spec assembly
├── app.ts         Express app (middleware + routes), no side effects
└── server.ts      actually starts listening — HTTP server + Socket.IO + shutdown
```

Every request flows `Route → Controller → Service → Repository → Postgres/Redis`.
Controllers never touch Prisma directly, and services never touch `req`/`res` —
this is what makes the ride-lifecycle logic reusable from both HTTP routes
*and* the background worker (see below).

---

## Database schema (Prisma)

`prisma/schema.prisma` has 7 models: `User`, `Driver`, `Vehicle`, `Ride`,
`RideEvent`, `Payment`, `Rating`. A few decisions worth explaining:

- **`Driver` is separate from `User`**, one-to-one. A `User` with role
  `DRIVER` doesn't automatically have driving capability until they call
  `POST /drivers/register` and get a `Driver` + `Vehicle` row. This mirrors
  a real onboarding flow (register account → complete driver onboarding)
  rather than conflating "is a driver" with "has a car and can accept rides."
- **`RideEvent` is an append-only audit log** of everything that happens to
  a ride (`RIDE_REQUESTED`, `DRIVER_ASSIGNED`, `RIDE_COMPLETED`, etc.),
  separate from the `Ride` row's current `status`. `Ride.status` answers
  "what state is this ride in right now"; `RideEvent` answers "how did it
  get there" — useful for debugging, support, and analytics, and it's how
  you'd reconstruct a timeline for a support ticket ("the rider says the
  driver never arrived — let's check the events").
- **Indexes** are on every foreign key used in a `WHERE` clause across the
  app (`riderId`, `driverId`, `status`, `createdAt` on `Ride`; `status` on
  `Driver`; etc.) — these are the columns `findManyForUser`,
  `assignDriverIfMatching`, and the "my rides" list queries actually filter
  on.

## Why Redis for driver location (not Postgres)

This is worth explaining carefully since it's the crux of requirement #8.

Driver location changes every few seconds per *active* driver, and "find
nearby available drivers" is a hot-path query that runs on every single ride
request. Doing that in Postgres means either:
- a full-table scan computing Haversine distance in SQL for every request, or
- a PostGIS geospatial index — which works, but still means writing to a
  durable, WAL-logged, (normally replicated) table dozens of times a second
  per active driver, for data that's purely "where is this driver **right
  now**." Nobody ever queries "where was driver X two days ago" from this
  table — that's not what it's for.

Redis's `GEOADD`/`GEOSEARCH` are backed by a sorted set with O(log N) inserts
and O(log N + M) radius queries, entirely in memory. It's the right tool for
"ephemeral, high-frequency, read-hot spatial state." Postgres stays the
source of truth for the `Driver` row itself (id, status, relations);
Redis is just a fast index over "who's near here right now" — see
`src/services/matching.service.ts` for the full comment-level explanation
and the actual `GEOADD`/`GEOSEARCH` calls.

One Redis sorted set exists *per vehicle type* (`drivers:geo:SEDAN`,
`drivers:geo:AUTO`, etc.) rather than one shared set with post-filtering —
that way `GEOSEARCH` never has to filter by vehicle type in application
code; it's just querying a different, smaller set.

---

## Why ride matching runs in a background job (not inline in the request)

`POST /rides` returns almost immediately with `status: "MATCHING"`. It does
**not** search for and wait on a driver synchronously. Matching can involve:
trying multiple candidates in order, waiting up to 15 seconds for each one to
accept, retrying if a driver declines/times out, and giving up after several
rounds if nobody's available. None of that belongs on the rider's HTTP
request/response cycle — the rider would be stuck on a loading spinner for
up to a minute. Instead:

1. `rideService.createRide()` creates the `Ride` row and enqueues a
   `find-and-offer` job on the `ride-matching` BullMQ queue, then returns.
2. The rider finds out what happens next via the ride's Socket.IO room
   (`ride:accepted`, `ride:no-drivers`, etc.) or by polling `GET /rides/:id`.
3. A **separate worker process** (`npm run worker`, its own `docker-compose`
   service) consumes that queue and does the actual algorithm.

### The matching algorithm (`src/jobs/ride-matching.processor.ts`)

```
find-and-offer job:
  1. Load the ride. If it's no longer MATCHING (cancelled already), stop.
  2. GEOSEARCH Redis for nearby AVAILABLE drivers of the right vehicle type,
     excluding anyone who already declined/timed out for this ride.
  3. Candidates come back sorted nearest-first (this project ranks by
     distance alone — NOT claiming this is Uber's real algorithm; a
     production system would also weight driver rating, acceptance rate,
     ETA via real routing, etc. — documented as a simplification).
  4. Walk the ranked list, trying to RESERVE the first driver.
  5. On success: pull them out of the geo pool, emit `ride:request` to
     their socket room, schedule an offer-timeout job for 15s later.
  6. If nobody could be reserved: retry after a short delay, or — after
     5 attempts — mark the ride NO_DRIVERS_FOUND and notify the rider.

offer-timeout job (fires 15s after an offer, unless already resolved):
  - If the ride is still MATCHING (driver didn't accept in time): release
    the reservation, put the driver back in the pool (if they're still
    online), and kick off another find-and-offer round excluding them.
  - If the ride moved to DRIVER_ASSIGNED (they accepted): no-op.
```

### The double-booking guard — the part worth understanding deeply

**The problem**: two riders could request a ride within milliseconds of each
other, both find the same nearest driver as their #1 candidate, and both
try to offer that driver a ride. Without a lock, both could succeed.

**The fix, in two independent layers:**

1. **Redis reservation lock** (`matchingService.reserveDriverForRide`):
   `SET reserve:{driverId} {rideId} NX PX 15000`. `NX` ("set if Not
   eXists") + a millisecond TTL is atomic — Redis guarantees only one
   caller can ever succeed in creating that key while it doesn't already
   exist, even under concurrent requests from different Node processes.
   This is the standard "Redis distributed lock" primitive. The moment a
   reservation succeeds, the driver is also removed from the geo pool
   entirely, so no *other* ride request can even find them as a candidate
   while the offer is pending.

2. **Atomic database guard** (`rideRepository.assignDriverIfMatching`):
   `UPDATE rides SET driverId = ?, status = 'DRIVER_ASSIGNED' WHERE id = ?
   AND status = 'MATCHING'`. Even in some pathological edge case where the
   Redis lock alone weren't sufficient, Postgres independently refuses to
   double-assign a ride — the `WHERE status = 'MATCHING'` means only the
   very first accept for a given ride can ever succeed; a second accept
   attempt affects zero rows and the code treats that as a 409 Conflict.

Belt and suspenders, on purpose — verified directly in
`tests/unit/matching.service.test.ts` with a test that fires 20 concurrent
reservation attempts at one driver and asserts exactly one wins, and in
`tests/integration/ride-lifecycle.test.ts` with a test that accepts the same
ride twice and asserts the second attempt gets a 409.

Every other ride-lifecycle transition (`arriving`, `arrived`, `start`,
`complete`, `cancel`) uses the same atomic `UPDATE ... WHERE status IN
(...)` pattern in `rideRepository.transitionStatus` — this is also what
prevents invalid transitions like `COMPLETED → IN_PROGRESS`: the `WHERE`
clause simply won't match, the update affects 0 rows, and the service layer
turns that into a 409.

---

## Real-time system (Socket.IO)

Every socket connection must present a JWT (`socket.handshake.auth.token`);
there's no anonymous socket access. On connect, a user automatically joins
their own room (`rider:{userId}` or `driver:{driverId}`), so the backend can
reach them without knowing their live socket id. To receive live updates
*about a specific ride* (location pings, status changes), the client
explicitly emits `ride:subscribe` with a `rideId` — the server checks the
requester is actually the ride's rider or assigned driver before letting
them join that ride's room. This is the guard against "arbitrary users
subscribing to another user's ride."

### Why there's a Redis Pub/Sub bridge (`src/sockets/emitter.ts`)

The background worker process has **no reference to the Socket.IO server
instance** — that object lives inside the API process. Rather than coupling
the worker to Socket.IO directly (which would mean running Socket.IO inside
the worker too, pointlessly), both the API's services *and* the worker
publish ride events to one Redis Pub/Sub channel
(`publishSocketEvent(room, event, payload)`). The API process subscribes to
that channel exactly once and re-emits each message to the right Socket.IO
room. This is also how a real multi-instance deployment would decouple any
number of API replicas and worker processes — they all just publish to the
same channel. (At real production scale you'd pair this with the official
`@socket.io/redis-adapter` so *room membership itself* is shared across
multiple API instances too; this project keeps a single API instance and
makes the underlying mechanism explicit instead of hiding it behind that
adapter — worth knowing both exist.)

### Live driver location during a ride

The driver's app emits `driver:location` over the socket; the handler
throttles updates per driver (`SET loc-throttle:{driverId} 1 PX 2000 NX` —
same atomic-lock pattern as the reservation lock, just used for throttling
instead of exclusivity), updates Postgres + the Redis geo pool via
`driverService.updateLocation`, then broadcasts `ride:location` to
`ride:{rideId}` so the rider's client receives it live.

---

## Ride state machine

```
REQUESTED* → MATCHING → DRIVER_ASSIGNED → DRIVER_ARRIVING → DRIVER_ARRIVED
    → IN_PROGRESS → COMPLETED

                    ↘ CANCELLED (from any pre-IN_PROGRESS state)
        MATCHING ↘ NO_DRIVERS_FOUND (after 5 failed matching rounds)
```
*`REQUESTED` exists in the enum for completeness/symmetry with the spec;
in practice a ride is created directly into `MATCHING` since matching starts
immediately — there's no meaningful gap between "requested" and "matching
has started."

Every transition is enforced by `rideRepository.transitionStatus`'s atomic
`WHERE status IN (validFromStates)` — see the double-booking section above.

## Fare calculation (`src/services/fare.service.ts`)

```
fare = max(
  (baseFare + distanceKm × perKmRate + estimatedMinutes × perMinuteRate) × vehicleMultiplier,
  minimumFare
)
```

Distance is Haversine (straight-line "as the crow flies"), and duration is
estimated from `distance / averageSpeedKmph` — this project does **not**
integrate a real routing/traffic API (OSRM, Google Directions, etc.), which
would give actual road-distance and traffic-aware ETAs. Called out here
rather than left implicit. Vehicle-type multipliers (`BIKE` 0.6× ...
`SUV` 1.4×) are simple, documented constants, not real-world city rate cards.

## Known simplifications (read this before treating any number as real)

- Fare/distance/ETA use straight-line distance, not real road routing.
- Driver ranking in matching is distance-only; no rating/acceptance-rate
  weighting (though `Rating` data exists and `ratingRepository.getDriverAverageRating`
  is there if you want to extend matching with it).
- Payment is fully mocked (`src/services/payment.service.ts`) — no real
  gateway integration; the *shape* of the integration (a `Payment` row with
  a status lifecycle) is real, so swapping in Stripe/Razorpay later means
  replacing the inside of `charge()`, not the surrounding architecture.
- No surge pricing, no cancellation fees, no multi-stop rides.
- Rate limiting is a simple fixed-window Redis counter, not a sliding
  window or token bucket — fine for this project's purposes, documented in
  `src/middleware/rate-limiter.ts` as a deliberate simplicity/complexity
  tradeoff.

## Environment variables

See `.env.example` for the full list with defaults — `DATABASE_URL`,
`REDIS_URL`, and `JWT_SECRET` are the only ones you must set explicitly;
everything else (matching radius, fare rates, rate limits) has a sensible
default and exists so you can tune the system's behavior without touching
code.
