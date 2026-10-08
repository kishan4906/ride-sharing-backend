import { Request, Response } from 'express';
import { driverService } from '../services/driver.service';
import { asyncHandler } from '../utils/asyncHandler';
import { UnauthorizedError } from '../errors/AppError';

export const registerDriver = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new UnauthorizedError();
  const driver = await driverService.registerDriver(req.user.id, req.body);
  res.status(201).json({ success: true, data: driver });
});

export const updateStatus = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new UnauthorizedError();
  const driver = await driverService.updateStatus(req.user.id, req.body.status);
  res.status(200).json({ success: true, data: driver });
});

export const updateLocation = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new UnauthorizedError();
  const driver = await driverService.updateLocation(req.user.id, req.body.latitude, req.body.longitude);
  res.status(200).json({ success: true, data: driver });
});

export const getDriverRides = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new UnauthorizedError();
  const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10));
  const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? '20'), 10)));
  const { rides, total } = await driverService.getDriverRides(req.user.id, (page - 1) * limit, limit);
  res.status(200).json({ success: true, data: rides, meta: { page, limit, total } });
});
