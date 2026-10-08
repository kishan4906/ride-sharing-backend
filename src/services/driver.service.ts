import { driverRepository } from '../repositories/driver.repository';
import { rideRepository } from '../repositories/ride.repository';
import { matchingService } from './matching.service';
import { ConflictError, NotFoundError, BadRequestError } from '../errors/AppError';
import { DriverStatus } from '@prisma/client';
import { RegisterDriverInput } from '../validators/driver.validators';
import { isValidLatitude, isValidLongitude } from '../utils/geo';

export const driverService = {
  async registerDriver(userId: string, input: RegisterDriverInput) {
    const existing = await driverRepository.findByUserId(userId);
    if (existing) throw new ConflictError('This user already has a driver profile');

    const driver = await driverRepository.create(userId);
    const vehicle = await driverRepository.createVehicle(driver.id, {
      vehicleType: input.vehicleType,
      make: input.make,
      model: input.model,
      licensePlate: input.licensePlate,
      color: input.color,
    });

    return { ...driver, vehicle };
  },

  async updateStatus(userId: string, status: DriverStatus) {
    const driver = await driverRepository.findByUserId(userId);
    if (!driver) throw new NotFoundError('Driver profile not found — register as a driver first');
    if (!driver.vehicle) throw new BadRequestError('Cannot go online without a registered vehicle');

    if (status === 'AVAILABLE') {
      if (driver.currentLatitude == null || driver.currentLongitude == null) {
        throw new BadRequestError('Set your current location before going online');
      }
      await matchingService.addOrUpdateDriver(driver.id, driver.vehicle.vehicleType, {
        latitude: driver.currentLatitude,
        longitude: driver.currentLongitude,
      });
    } else {
      // OFFLINE or BUSY — either way, stop surfacing this driver as a match candidate
      await matchingService.removeDriver(driver.id);
    }

    return driverRepository.updateStatus(driver.id, status);
  },

  async updateLocation(userId: string, latitude: number, longitude: number) {
    if (!isValidLatitude(latitude) || !isValidLongitude(longitude)) {
      throw new BadRequestError('Invalid coordinates');
    }

    const driver = await driverRepository.findByUserId(userId);
    if (!driver) throw new NotFoundError('Driver profile not found');

    const updated = await driverRepository.updateLocation(driver.id, latitude, longitude);

    // Keep the Redis pool in sync ONLY if this driver is currently listed as
    // available — a driver who's OFFLINE/BUSY shouldn't reappear as a match
    // candidate just because their GPS kept reporting in the background.
    if (driver.status === 'AVAILABLE' && driver.vehicle) {
      await matchingService.addOrUpdateDriver(driver.id, driver.vehicle.vehicleType, { latitude, longitude });
    }

    return updated;
  },

  async getDriverRides(userId: string, skip: number, take: number) {
    const driver = await driverRepository.findByUserId(userId);
    if (!driver) throw new NotFoundError('Driver profile not found');
    const [rides, total] = await rideRepository.findManyForUser({ driverId: driver.id, skip, take });
    return { rides, total };
  },

  async requireDriverProfile(userId: string) {
    const driver = await driverRepository.findByUserId(userId);
    if (!driver) throw new NotFoundError('Driver profile not found — register as a driver first');
    return driver;
  },
};
