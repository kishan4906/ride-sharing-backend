import { Role } from '@prisma/client';

// Attached to req.user by the auth middleware after verifying the JWT.
export interface AuthenticatedUser {
  id: string;
  email: string;
  role: Role;
  driverId?: string; // present only if the user has a Driver profile
}

// Extends Express's Request type globally — see middleware/auth.ts
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface DriverCandidate {
  driverId: string;
  userId: string;
  distanceKm: number;
  latitude: number;
  longitude: number;
}

export interface JwtPayload {
  sub: string; // user id
  email: string;
  role: Role;
}

export {};
