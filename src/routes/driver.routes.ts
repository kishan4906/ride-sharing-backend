import { Router } from 'express';
import { registerDriver, updateStatus, updateLocation, getDriverRides } from '../controllers/driver.controller';
import { validate } from '../middleware/validate';
import { registerDriverSchema, updateDriverStatusSchema, updateDriverLocationSchema } from '../validators/driver.validators';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { rateLimiter } from '../middleware/rate-limiter';

const router = Router();

/**
 * @openapi
 * /drivers/register:
 *   post:
 *     tags: [Drivers]
 *     summary: Register the current user as a driver (creates Driver + Vehicle)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [vehicleType, make, model, licensePlate, color]
 *             properties:
 *               vehicleType: { type: string, enum: [BIKE, AUTO, SEDAN, SUV] }
 *               make: { type: string }
 *               model: { type: string }
 *               licensePlate: { type: string }
 *               color: { type: string }
 *     responses:
 *       201: { description: Driver profile created }
 */
router.post('/register', requireAuth, requireRole('DRIVER'), validate(registerDriverSchema), registerDriver);

/**
 * @openapi
 * /drivers/status:
 *   patch:
 *     tags: [Drivers]
 *     summary: Go online (AVAILABLE), offline, or mark BUSY
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [OFFLINE, AVAILABLE, BUSY] }
 *     responses:
 *       200: { description: Status updated }
 */
router.patch('/status', requireAuth, requireRole('DRIVER'), validate(updateDriverStatusSchema), updateStatus);

/**
 * @openapi
 * /drivers/location:
 *   patch:
 *     tags: [Drivers]
 *     summary: Update the driver's current location
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [latitude, longitude]
 *             properties:
 *               latitude: { type: number }
 *               longitude: { type: number }
 *     responses:
 *       200: { description: Location updated }
 */
router.patch(
  '/location',
  requireAuth,
  requireRole('DRIVER'),
  rateLimiter({ max: 60, windowMs: 60_000, keyPrefix: 'loc-http' }),
  validate(updateDriverLocationSchema),
  updateLocation
);

/**
 * @openapi
 * /drivers/rides:
 *   get:
 *     tags: [Drivers]
 *     summary: List the driver's own rides
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: List of rides }
 */
router.get('/rides', requireAuth, requireRole('DRIVER'), getDriverRides);

export default router;
