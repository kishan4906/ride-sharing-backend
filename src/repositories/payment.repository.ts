import { prisma } from '../config/db';
import { PaymentMethod, PaymentStatus } from '@prisma/client';

export const paymentRepository = {
  create(data: { rideId: string; amount: number; paymentMethod: PaymentMethod }) {
    return prisma.payment.create({ data: { ...data, status: 'PENDING' } });
  },

  updateStatus(rideId: string, status: PaymentStatus, transactionId?: string) {
    return prisma.payment.update({ where: { rideId }, data: { status, transactionId } });
  },

  findByRideId(rideId: string) {
    return prisma.payment.findUnique({ where: { rideId } });
  },
};

export const ratingRepository = {
  create(data: { rideId: string; riderId: string; driverId: string; rating: number; comment?: string }) {
    return prisma.rating.create({ data });
  },

  findByRideId(rideId: string) {
    return prisma.rating.findUnique({ where: { rideId } });
  },

  /** Simple average rating for a driver — used for optional matching rank boost. */
  async getDriverAverageRating(driverId: string): Promise<number | null> {
    const agg = await prisma.rating.aggregate({
      where: { driverId },
      _avg: { rating: true },
    });
    return agg._avg.rating;
  },
};
