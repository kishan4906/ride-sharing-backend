import { prisma } from '../config/db';
import { RideStatus, VehicleType, Prisma } from '@prisma/client';

export const rideRepository = {
  create(data: {
    riderId: string;
    pickupLatitude: number;
    pickupLongitude: number;
    destinationLatitude: number;
    destinationLongitude: number;
    vehicleType: VehicleType;
    estimatedDistance: number;
    estimatedFare: number;
  }) {
    return prisma.ride.create({ data: { ...data, status: 'MATCHING' } });
  },

  findById(id: string) {
    return prisma.ride.findUnique({
      where: { id },
      include: {
        rider: { select: { id: true, name: true, phone: true } },
        driver: { include: { user: { select: { id: true, name: true, phone: true } }, vehicle: true } },
        payment: true,
        rating: true,
      },
    });
  },

  findManyForUser(params: { riderId?: string; driverId?: string; skip: number; take: number }) {
    const where: Prisma.RideWhereInput = {};
    if (params.riderId) where.riderId = params.riderId;
    if (params.driverId) where.driverId = params.driverId;

    return prisma.$transaction([
      prisma.ride.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: params.skip,
        take: params.take,
        include: { driver: { include: { user: { select: { name: true } }, vehicle: true } } },
      }),
      prisma.ride.count({ where }),
    ]);
  },

  /**
   * Atomically assigns a driver to a ride ONLY if the ride is still in
   * MATCHING status. This is the database-side half of the double-booking
   * guard described in matching.service.ts — even if two matching attempts
   * somehow both pass the Redis lock (e.g. after a lock expiry race), only
   * one of these updateMany calls will affect a row, because the WHERE
   * clause re-checks status atomically at the database level.
   *
   * Returns the number of rows updated: 1 = success, 0 = someone else beat
   * us to it (or the ride was cancelled in the meantime).
   */
  async assignDriverIfMatching(rideId: string, driverId: string): Promise<number> {
    const result = await prisma.ride.updateMany({
      where: { id: rideId, status: 'MATCHING' },
      data: { driverId, status: 'DRIVER_ASSIGNED' },
    });
    return result.count;
  },

  /**
   * Generic guarded transition: only moves `from` → `to` if the ride is
   * currently in `from`. Used for every other lifecycle step (arriving,
   * arrived, start, complete, cancel) to prevent invalid/duplicate
   * transitions (e.g. completing a ride twice, or starting a cancelled ride).
   */
  async transitionStatus(
    rideId: string,
    from: RideStatus[],
    to: RideStatus,
    extraData: Prisma.RideUpdateInput = {}
  ): Promise<number> {
    const result = await prisma.ride.updateMany({
      where: { id: rideId, status: { in: from } },
      data: { status: to, ...extraData },
    });
    return result.count;
  },

  setFinalFare(rideId: string, finalFare: number) {
    return prisma.ride.update({ where: { id: rideId }, data: { finalFare } });
  },

  addEvent(rideId: string, eventType: Prisma.RideEventCreateInput['eventType'], metadata?: object) {
    return prisma.rideEvent.create({
      data: { rideId, eventType, metadata: metadata as Prisma.InputJsonValue },
    });
  },

  getEvents(rideId: string) {
    return prisma.rideEvent.findMany({ where: { rideId }, orderBy: { createdAt: 'asc' } });
  },
};

export type RideRepository = typeof rideRepository;
