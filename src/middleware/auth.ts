import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/jwt';
import { UnauthorizedError } from '../errors/AppError';

/**
 * Verifies the Bearer token and attaches { id, email, role } to req.user.
 * Deliberately does NOT look up the full user/driver record from the DB on
 * every request — that would be a wasted query for most routes. Routes that
 * need the full Driver record (e.g. accepting a ride) fetch it explicitly
 * in their service, keyed off req.user.id.
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    return next(new UnauthorizedError('Missing or malformed Authorization header'));
  }

  const token = header.slice('Bearer '.length).trim();
  const payload = verifyToken(token);

  req.user = {
    id: payload.sub,
    email: payload.email,
    role: payload.role,
  };

  next();
}
