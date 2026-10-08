import { rideRepository } from '../repositories/ride.repository';
import { driverRepository } from '../repositories/driver.repository';
import { ratingRepository } from '../repositories/payment.repository';
import { matchingService } from './matching.service';
import { estimateFare } from './fare.service';
import { paymentService } from './payment.service';
import { enqueueFindAndOffer } from '../jobs/queues';
import { publishSocketEvent, rooms } from '../sockets/emitter';
import { BadRequestError, ForbiddenError, NotFoundError, ConflictError } from '../errors/AppError';
import { CreateRideInput, RateRideInput } from '../validators/ride.validators';
import { isValidLatitude, isValidLongitude } from '../utils/geo';
import { logger } from '../config/logger';

export const rideService = {
  // ─── Rider: create a ride request ────────────────────────────────────────
  async createRide(riderId: string, input: CreateRideInput) {
    const { pickup, destination, vehicleType } = input;

    if (!isValidLatitude(pickup.latitude) || !isValidLongitude(pickup.longitude)) {
      throw new BadRequestError('Invalid pickup coordinates');
    }
    if (!isValidLatitude(destination.latitude) || !isValidLongitude(destination.longitude)) {
      throw new BadRequestError('Invalid destination coordinates');
    }

    const { distanceKm, fare } = estimateFare(pickup, destination, vehicleType);

    const ride = await rideRepository.create({
      riderId,
      pickupLatitude: pickup.latitude,
      pickupLongitude: pickup.longitude,
      destinationLatitude: destination.latitude,
      destinationLongitude: destination.longitude,
      vehicleType,
      estimatedDistance: distanceKm,
      estimatedFare: fare,
    });

    await rideRepository.addEvent(ride.id, 'RIDE_REQUESTED', { pickup, destination, vehicleType });
    await rideRepository.addEvent(ride.id, 'MATCHING_STARTED', {});

    // Hand off to the background matching worker rather than searching for
    // (and offering to) a driver synchronously inside this HTTP request.
    // Matching can involve multiple candidates, a 15s accept-timeout, and
    // retries — none of that belongs on the rider's request/response cycle.
    // The rider instead polls GET /rides/:id or listens on the ride's
    // socket room for status updates.
    await enqueueFindAndOffer(ride.id);

    return ride;
  },

  async getRideById(rideId: string, requester: { id: string; role: string }) {
    const ride = await rideRepository.findById(rideId);
    if (!ride) throw new NotFoundError('Ride not found');

    const isRider = ride.riderId === requester.id;
    const isAssignedDriver = ride.driver?.user.id === requester.id;
    const isAdmin = requester.role === 'ADMIN';

    if (!isRider && !isAssignedDriver && !isAdmin) {
      throw new ForbiddenError('You do not have access to this ride');
    }

    return ride;
  },

  async listRidesForRider(riderId: string, skip: number, take: number) {
    const [rides, total] = await rideRepository.findManyForUser({ riderId, skip, take });
    return { rides, total };
  },

  // ─── Rider: cancel ────────────────────────────────────────────────────────
  async cancelRide(rideId: string, riderId: string) {
    const ride = await rideRepository.findById(rideId);
    if (!ride) throw new NotFoundError('Ride not found');
    if (ride.riderId !== riderId) throw new ForbiddenError('You can only cancel your own rides');

    // Can't cancel a ride that's already finished/cancelled, or already
    // underway (in a real system, a late cancellation would still be
    // allowed but might carry a cancellation fee — out of scope here).
    const cancellableFrom = ['REQUESTED', 'MATCHING', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED'] as const;
    const updatedCount = await rideRepository.transitionStatus(rideId, [...cancellableFrom], 'CANCELLED', {
      cancelledAt: new Date(),
    });

    if (updatedCount === 0) {
      throw new ConflictError(`Ride cannot be cancelled from its current status (${ride.status})`);
    }

    await rideRepository.addEvent(rideId, 'RIDE_CANCELLED', { cancelledBy: 'RIDER' });

    // If a driver was reserved/assigned, free them back up immediately.
    if (ride.driverId) {
      await matchingService.releaseDriverReservation(ride.driverId);
      const driver = await driverRepository.findById(ride.driverId);
      if (driver?.status === 'BUSY') {
        await driverRepository.updateStatus(ride.driverId, 'AVAILABLE');
        if (driver.vehicle && driver.currentLatitude != null && driver.currentLongitude != null) {
          await matchingService.addOrUpdateDriver(ride.driverId, driver.vehicle.vehicleType, {
            latitude: driver.currentLatitude,
            longitude: driver.currentLongitude,
          });
        }
      }
      await publishSocketEvent(rooms.driver(ride.driverId), 'ride:cancelled', { rideId });
    }

    await publishSocketEvent(rooms.ride(rideId), 'ride:cancelled', { rideId });
    return rideRepository.findById(rideId);
  },

  // ─── Driver: accept an offered ride ──────────────────────────────────────
  // See matching.service.ts for the full explanation of the reservation
  // lock this depends on. Short version: the matching worker already
  // reserved this specific driver for this specific ride (via a Redis
  // SET-NX lock) before emitting the `ride:request` socket event — so by
  // the time this runs, we're just confirming an offer that was already
  // exclusively theirs, then making it durable in Postgres.
  async acceptRide(rideId: string, driverUserId: string) {
    const driver = await driverRepository.findByUserId(driverUserId);
    if (!driver) throw new NotFoundError('Driver profile not found');

    const offeredRideId = await matchingService.getRideOfferedToDriver(driver.id);
    if (offeredRideId !== rideId) {
      throw new ForbiddenError('This ride was not offered to you (it may have expired or gone to another driver)');
    }

    // Atomic DB-level guard: only succeeds if the ride is still MATCHING.
    // This is the second independent safety net described in
    // matching.service.ts — belt AND suspenders against double-assignment.
    const updatedCount = await rideRepository.assignDriverIfMatching(rideId, driver.id);
    if (updatedCount === 0) {
      throw new ConflictError('This ride is no longer available (it may have been cancelled or already accepted)');
    }

    await driverRepository.updateStatus(driver.id, 'BUSY');
    await matchingService.releaseDriverReservation(driver.id); // reservation's job is done — Postgres BUSY status is now authoritative

    await rideRepository.addEvent(rideId, 'DRIVER_ASSIGNED', { driverId: driver.id });

    const ride = await rideRepository.findById(rideId);
    await publishSocketEvent(rooms.ride(rideId), 'ride:accepted', { rideId, driver: ride?.driver });
    return ride;
  },

  // ─── Driver: lifecycle transitions ───────────────────────────────────────
  async markArriving(rideId: string, driverUserId: string) {
    return this._driverTransition(rideId, driverUserId, ['DRIVER_ASSIGNED'], 'DRIVER_ARRIVING', 'DRIVER_ARRIVING', 'ride:driver-arriving');
  },

  async markArrived(rideId: string, driverUserId: string) {
    return this._driverTransition(rideId, driverUserId, ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING'], 'DRIVER_ARRIVED', 'DRIVER_ARRIVED', 'ride:driver-arrived');
  },

  async startRide(rideId: string, driverUserId: string) {
    return this._driverTransition(
      rideId,
      driverUserId,
      ['DRIVER_ARRIVED', 'DRIVER_ASSIGNED'],
      'IN_PROGRESS',
      'RIDE_STARTED',
      'ride:started',
      { startedAt: new Date() }
    );
  },

  async completeRide(rideId: string, driverUserId: string, paymentMethod: 'CASH' | 'CARD' | 'WALLET' = 'CASH') {
    const driver = await driverRepository.findByUserId(driverUserId);
    if (!driver) throw new NotFoundError('Driver profile not found');

    const ride = await rideRepository.findById(rideId);
    if (!ride) throw new NotFoundError('Ride not found');
    if (ride.driverId !== driver.id) throw new ForbiddenError('This is not your ride');

    const updatedCount = await rideRepository.transitionStatus(rideId, ['IN_PROGRESS'], 'COMPLETED', {
      completedAt: new Date(),
    });
    if (updatedCount === 0) {
      throw new ConflictError(`Ride cannot be completed from its current status (${ride.status})`);
    }

    const finalFare = ride.estimatedFare ?? 0;
    await rideRepository.setFinalFare(rideId, finalFare);
    await rideRepository.addEvent(rideId, 'RIDE_COMPLETED', { finalFare });

    // Free the driver back up for new rides
    await driverRepository.updateStatus(driver.id, 'AVAILABLE');
    if (driver.vehicle && driver.currentLatitude != null && driver.currentLongitude != null) {
      await matchingService.addOrUpdateDriver(driver.id, driver.vehicle.vehicleType, {
        latitude: driver.currentLatitude,
        longitude: driver.currentLongitude,
      });
    }

    await rideRepository.addEvent(rideId, 'PAYMENT_CREATED', { amount: finalFare, method: paymentMethod });
    const payment = await paymentService.createAndCharge(rideId, finalFare, paymentMethod);
    await rideRepository.addEvent(
      rideId,
      payment.status === 'COMPLETED' ? 'PAYMENT_COMPLETED' : 'PAYMENT_FAILED',
      { paymentId: payment.id }
    );

    const updatedRide = await rideRepository.findById(rideId);
    await publishSocketEvent(rooms.ride(rideId), 'ride:completed', { rideId, finalFare, payment });
    return updatedRide;
  },

  // Shared implementation for the simple DRIVER_ASSIGNED → ARRIVING → ARRIVED → IN_PROGRESS chain
  async _driverTransition(
    rideId: string,
    driverUserId: string,
    fromStatuses: Parameters<typeof rideRepository.transitionStatus>[1],
    toStatus: Parameters<typeof rideRepository.transitionStatus>[2],
    eventType: Parameters<typeof rideRepository.addEvent>[1],
    socketEvent: string,
    extraData: Record<string, unknown> = {}
  ) {
    const driver = await driverRepository.findByUserId(driverUserId);
    if (!driver) throw new NotFoundError('Driver profile not found');

    const ride = await rideRepository.findById(rideId);
    if (!ride) throw new NotFoundError('Ride not found');
    if (ride.driverId !== driver.id) throw new ForbiddenError('This is not your ride');

    const updatedCount = await rideRepository.transitionStatus(rideId, fromStatuses, toStatus, extraData);
    if (updatedCount === 0) {
      throw new ConflictError(`Invalid state transition: cannot move to ${toStatus} from ${ride.status}`);
    }

    await rideRepository.addEvent(rideId, eventType, {});
    const updatedRide = await rideRepository.findById(rideId);
    await publishSocketEvent(rooms.ride(rideId), socketEvent, { rideId, status: toStatus });
    return updatedRide;
  },

  // ─── Rider: rate a completed ride ────────────────────────────────────────
  async rateRide(rideId: string, riderId: string, input: RateRideInput) {
    const ride = await rideRepository.findById(rideId);
    if (!ride) throw new NotFoundError('Ride not found');
    if (ride.riderId !== riderId) throw new ForbiddenError('You can only rate your own rides');
    if (ride.status !== 'COMPLETED') throw new BadRequestError('You can only rate completed rides');
    if (!ride.driverId) throw new BadRequestError('This ride has no assigned driver to rate');

    const existing = await ratingRepository.findByRideId(rideId);
    if (existing) throw new ConflictError('This ride has already been rated');

    return ratingRepository.create({
      rideId,
      riderId,
      driverId: ride.driverId,
      rating: input.rating,
      comment: input.comment,
    });
  },
};
