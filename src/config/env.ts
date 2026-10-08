// ─── Environment Config ────────────────────────────────────────────────────
// The ONLY file that reads process.env directly. Everything else imports
// `env` from here. This means: (a) one place to see every config value the
// app depends on, (b) the app fails fast at boot with a clear error instead
// of crashing mysteriously later when some deep module hits `undefined`.
// ─────────────────────────────────────────────────────────────────────────────

import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  JWT_SECRET: z.string().min(10, 'JWT_SECRET should be a real secret, not a placeholder'),
  JWT_EXPIRES_IN: z.string().default('7d'),

  MATCHING_SEARCH_RADIUS_KM: z.coerce.number().default(5),
  MATCHING_MAX_CANDIDATES: z.coerce.number().default(10),

  FARE_BASE: z.coerce.number().default(40),
  FARE_PER_KM: z.coerce.number().default(12),
  FARE_PER_MINUTE: z.coerce.number().default(1.5),
  FARE_MINIMUM: z.coerce.number().default(60),
  AVERAGE_SPEED_KMPH: z.coerce.number().default(25),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60_000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(100),
  LOCATION_UPDATE_MIN_INTERVAL_MS: z.coerce.number().default(2000),

  CORS_ORIGIN: z.string().default('*'),
  LOG_LEVEL: z.string().default('info'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Fail fast and loud — a misconfigured env is the #1 cause of confusing
  // "works on my machine" bugs, so we never let the app start half-configured.
  console.error('❌ Invalid environment configuration:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
