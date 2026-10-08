// ─── Integration tests ──────────────────────────────────────────────────────
// These exercise the real Express app end-to-end (HTTP → controller →
// service → repository → Postgres/Redis), unlike the pure-function unit
// tests in tests/unit/. They require a running Postgres + Redis — normally
// the ones docker-compose spins up.
//
// Run with:
//   docker-compose up -d postgres redis
//   DATABASE_URL=... REDIS_URL=... npx prisma migrate deploy
//   npm run test
//
// (Or simplest: `docker-compose up` brings up the whole stack, then run
// these against it from your host with .env.test pointed at the exposed
// ports — see README "Testing" section.)
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';

const app = createApp();

describe('GET /health', () => {
  it('returns 200 and ok status', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('GET /api/v1/unknown-route', () => {
  it('returns a consistent 404 JSON shape', async () => {
    const res = await request(app).get('/api/v1/this-route-does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
