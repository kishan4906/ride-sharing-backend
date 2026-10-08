// Requires a real Postgres (docker-compose up -d postgres, then
// `DATABASE_URL=... npx prisma migrate deploy` against it once).
// Run: npx vitest run tests/integration/auth.test.ts

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/config/db';

const app = createApp();

const testUser = {
  name: 'Test Rider',
  email: `test-rider-${Date.now()}@example.com`,
  phone: `+91900000${Math.floor(Math.random() * 10000)}`,
  password: 'TestPassword123!',
  role: 'RIDER' as const,
};

describe('Auth flow', () => {
  it('registers a new user and returns a token', async () => {
    const res = await request(app).post('/api/v1/auth/register').send(testUser);
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toBeTruthy();
    expect(res.body.data.user.email).toBe(testUser.email);
    expect(res.body.data.user.passwordHash).toBeUndefined(); // never leak the hash
  });

  it('rejects registering the same email twice', async () => {
    const res = await request(app).post('/api/v1/auth/register').send(testUser);
    expect(res.status).toBe(409);
  });

  it('rejects registration with an invalid password (too short)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ ...testUser, email: `another-${Date.now()}@example.com`, password: '123' });
    expect(res.status).toBe(422);
  });

  it('logs in with correct credentials', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: testUser.email, password: testUser.password });
    expect(res.status).toBe(200);
    expect(res.body.data.token).toBeTruthy();
  });

  it('rejects login with wrong password', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: testUser.email, password: 'WrongPassword!' });
    expect(res.status).toBe(401);
  });

  it('returns the current user for a valid token', async () => {
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: testUser.email, password: testUser.password });
    const token = loginRes.body.data.token;

    const meRes = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
    expect(meRes.status).toBe(200);
    expect(meRes.body.data.email).toBe(testUser.email);
  });

  it('rejects /auth/me with no token', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  });
});
