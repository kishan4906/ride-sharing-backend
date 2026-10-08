import { Router } from 'express';
import {
  createRide,
  listMyRides,
  getRide,
  cancelRide,
  rateRide,
  acceptRide,
  markArriving,
  markArrived,
  startRide,
  completeRide,
} from '../controllers/ride.controller';
import { validate } from '../middleware/validate';
import { createRideSchema, rideIdParamSchema, rateRideSchema } from '../validators/ride.validators';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { rateLimiter } from '../middleware/rate-limiter';

const router = Router();

/**
 * @openapi
 * /rides:
 *   post:
 *     tags: [Rides]
 *     summary: Request a new ride (rider only)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [pickup, destination, vehicleType]
 *             properties:
 *               pickup: { type: object, properties: { latitude: {type: number}, longitude: {type: number} } }
 *               destination: { type: object, properties: { latitude: {type: number}, longitude: {type: number} } }
 *               vehicleType: { type: string, enum: [BIKE, AUTO, SEDAN, SUV] }
 *     responses:
 *       201: { description: Ride created, matching started in the background }
 *   get:
 *     tags: [Rides]
 *     summary: List the current rider's rides
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: List of rides }
 */
router.post(
  '/',
  requireAuth,
  requireRole('RIDER'),
  rateLimiter({ max: 10, windowMs: 60_000, keyPrefix: 'ride-create' }),
  validate(createRideSchema),
  createRide
);
router.get('/', requireAuth, requireRole('RIDER'), listMyRides);

/**
 * @openapi
 * /rides/{id}:
 *   get:
 *     tags: [Rides]
 *     summary: Get a single ride's details (rider, assigned driver, or admin only)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Ride details }
 *       403: { description: Not authorized to view this ride }
 *       404: { description: Ride not found }
 */
router.get('/:id', requireAuth, validate(rideIdParamSchema), getRide);

/**
 * @openapi
 * /rides/{id}/cancel:
 *   post:
 *     tags: [Rides]
 *     summary: Cancel a ride (rider only, before it's in progress)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Ride cancelled }
 *       409: { description: Ride cannot be cancelled from its current state }
 */
router.post('/:id/cancel', requireAuth, requireRole('RIDER'), validate(rideIdParamSchema), cancelRide);

/**
 * @openapi
 * /rides/{id}/rating:
 *   post:
 *     tags: [Rides]
 *     summary: Rate a completed ride (rider only)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [rating]
 *             properties:
 *               rating: { type: integer, minimum: 1, maximum: 5 }
 *               comment: { type: string }
 *     responses:
 *       201: { description: Rating submitted }
 */
router.post('/:id/rating', requireAuth, requireRole('RIDER'), validate(rateRideSchema), rateRide);

// ── Driver-side lifecycle actions on a specific ride ──────────────────────

/**
 * @openapi
 * /rides/{id}/accept:
 *   post:
 *     tags: [Rides]
 *     summary: Driver accepts an offered ride
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Ride accepted, driver assigned }
 *       403: { description: This ride was not offered to you }
 *       409: { description: Ride no longer available (already accepted/cancelled) }
 */
router.post('/:id/accept', requireAuth, requireRole('DRIVER'), validate(rideIdParamSchema), acceptRide);

/**
 * @openapi
 * /rides/{id}/arriving:
 *   post:
 *     tags: [Rides]
 *     summary: Driver marks that they are en route to pickup
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Status updated }
 */
router.post('/:id/arriving', requireAuth, requireRole('DRIVER'), validate(rideIdParamSchema), markArriving);

/**
 * @openapi
 * /rides/{id}/arrived:
 *   post:
 *     tags: [Rides]
 *     summary: Driver marks that they have arrived at pickup
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Status updated }
 */
router.post('/:id/arrived', requireAuth, requireRole('DRIVER'), validate(rideIdParamSchema), markArrived);

/**
 * @openapi
 * /rides/{id}/start:
 *   post:
 *     tags: [Rides]
 *     summary: Driver starts the ride
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Ride started }
 */
router.post('/:id/start', requireAuth, requireRole('DRIVER'), validate(rideIdParamSchema), startRide);

/**
 * @openapi
 * /rides/{id}/complete:
 *   post:
 *     tags: [Rides]
 *     summary: Driver completes the ride (triggers payment)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               paymentMethod: { type: string, enum: [CASH, CARD, WALLET] }
 *     responses:
 *       200: { description: Ride completed, payment processed }
 */
router.post('/:id/complete', requireAuth, requireRole('DRIVER'), validate(rideIdParamSchema), completeRide);

export default router;
