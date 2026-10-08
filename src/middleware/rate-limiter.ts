import { Request, Response, NextFunction } from 'express';
import { redis } from '../config/redis';
import { env } from '../config/env';
import { TooManyRequestsError } from '../errors/AppError';

/**
 * Fixed-window counter using Redis INCR + EXPIRE. Simple and good enough for
 * this project; a sliding-window-log or token-bucket would be smoother
 * under bursty traffic but adds complexity this educational API doesn't
 * need. Keyed by user id when authenticated, else by IP.
 */
export function rateLimiter(options?: { windowMs?: number; max?: number; keyPrefix?: string }) {
  const windowMs = options?.windowMs ?? env.RATE_LIMIT_WINDOW_MS;
  const max = options?.max ?? env.RATE_LIMIT_MAX_REQUESTS;
  const prefix = options?.keyPrefix ?? 'ratelimit';

  return async (req: Request, res: Response, next: NextFunction) => {
    const identity = req.user?.id ?? req.ip ?? 'anonymous';
    const key = `${prefix}:${identity}`;

    try {
      const count = await redis.incr(key);
      if (count === 1) {
        await redis.pexpire(key, windowMs);
      }

      const ttl = await redis.pttl(key);
      res.setHeader('X-RateLimit-Limit', max);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, max - count));

      if (count > max) {
        return next(new TooManyRequestsError(`Rate limit exceeded. Try again in ${Math.ceil(ttl / 1000)}s.`));
      }
      next();
    } catch (err) {
      // If Redis is briefly unavailable, fail OPEN (allow the request) rather
      // than taking the whole API down over a rate-limit check.
      next();
    }
  };
}

/**
 * Stricter throttle specifically for driver location updates — these come
 * from a socket/HTTP stream at high frequency and a buggy or malicious
 * client could otherwise flood the server. Enforces a MINIMUM gap between
 * accepted updates per driver, using Redis SET with NX + PX as an atomic
 * "was this driver's last update recent?" check.
 */
export async function isLocationUpdateAllowed(driverId: string): Promise<boolean> {
  const key = `loc-throttle:${driverId}`;
  // SET key value NX PX ttl → succeeds (returns 'OK') only if the key didn't
  // already exist, i.e. only if the driver hasn't updated within the window.
  const result = await redis.set(key, '1', 'PX', env.LOCATION_UPDATE_MIN_INTERVAL_MS, 'NX');
  return result === 'OK';
}
