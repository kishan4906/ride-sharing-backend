import { Request, Response, NextFunction } from 'express';
import { Role } from '@prisma/client';
import { ForbiddenError, UnauthorizedError } from '../errors/AppError';

/**
 * Usage: router.post('/rides', requireAuth, requireRole('RIDER'), createRide)
 * Must run AFTER requireAuth (needs req.user already populated).
 */
export function requireRole(...allowedRoles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new UnauthorizedError('Authentication required'));
    }
    if (!allowedRoles.includes(req.user.role)) {
      return next(
        new ForbiddenError(`This action requires one of the following roles: ${allowedRoles.join(', ')}`)
      );
    }
    next();
  };
}
