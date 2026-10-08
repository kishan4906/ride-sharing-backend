import { Request, Response } from 'express';
import { rideService } from '../services/ride.service';
import { asyncHandler } from '../utils/asyncHandler';
import { UnauthorizedError } from '../errors/AppError';

export const createRide = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new UnauthorizedError();
  const ride = await rideService.createRide(req.user.id, req.body);
  res.status(201).json({
    success: true,
    data: {
      rideId: ride.id,
      status: ride.status,
      estimatedFare: ride.estimatedFare,
      estimatedDistance: ride.estimatedDistance,
    },
  });
});

export const listMyRides = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new UnauthorizedError();
  const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10));
  const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? '20'), 10)));
  const { rides, total } = await rideService.listRidesForRider(req.user.id, (page - 1) * limit, limit);
  res.status(200).json({ success: true, data: rides, meta: { page, limit, total } });
});

export const getRide = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new UnauthorizedError();
  const ride = await rideService.getRideById(req.params.id, req.user);
  res.status(200).json({ success: true, data: ride });
});

export const cancelRide = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new UnauthorizedError();
  const ride = await rideService.cancelRide(req.params.id, req.user.id);
  res.status(200).json({ success: true, data: ride });
});

export const rateRide = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new UnauthorizedError();
  const rating = await rideService.rateRide(req.params.id, req.user.id, req.body);
  res.status(201).json({ success: true, data: rating });
});

// ── Driver-side lifecycle actions ─────────────────────────────────────────

export const acceptRide = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new UnauthorizedError();
  const ride = await rideService.acceptRide(req.params.id, req.user.id);
  res.status(200).json({ success: true, data: ride });
});

export const markArriving = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new UnauthorizedError();
  const ride = await rideService.markArriving(req.params.id, req.user.id);
  res.status(200).json({ success: true, data: ride });
});

export const markArrived = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new UnauthorizedError();
  const ride = await rideService.markArrived(req.params.id, req.user.id);
  res.status(200).json({ success: true, data: ride });
});

export const startRide = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new UnauthorizedError();
  const ride = await rideService.startRide(req.params.id, req.user.id);
  res.status(200).json({ success: true, data: ride });
});

export const completeRide = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new UnauthorizedError();
  const ride = await rideService.completeRide(req.params.id, req.user.id, req.body?.paymentMethod);
  res.status(200).json({ success: true, data: ride });
});
