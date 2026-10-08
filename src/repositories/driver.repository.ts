import { prisma } from '../config/db';
import { DriverStatus, VehicleType } from '@prisma/client';

export const driverRepository = {
  create(userId: string) {
    return prisma.driver.create({ data: { userId, status: 'OFFLINE' } });
  },

  findByUserId(userId: string) {
    return prisma.driver.findUnique({ where: { userId }, include: { vehicle: true } });
  },

  findById(id: string) {
    return prisma.driver.findUnique({ where: { id }, include: { vehicle: true, user: true } });
  },

  updateStatus(driverId: string, status: DriverStatus) {
    return prisma.driver.update({ where: { id: driverId }, data: { status } });
  },

  updateLocation(driverId: string, latitude: number, longitude: number) {
    return prisma.driver.update({
      where: { id: driverId },
      data: { currentLatitude: latitude, currentLongitude: longitude, lastLocationUpdate: new Date() },
    });
  },

  createVehicle(
    driverId: string,
    data: { vehicleType: VehicleType; make: string; model: string; licensePlate: string; color: string }
  ) {
    return prisma.vehicle.create({ data: { driverId, ...data } });
  },
};

export type DriverRepository = typeof driverRepository;
