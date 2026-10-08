import { env } from '../config/env';
import { Coordinates } from '../types';
import { haversineDistanceKm } from '../utils/geo';
import { VehicleType } from '@prisma/client';

// Simple per-vehicle-type multipliers on top of the base fare formula.
// Not modeling real-world surge pricing, tolls, or city-specific rates —
// documented as a simplification, not a hidden gap.
const VEHICLE_MULTIPLIER: Record<VehicleType, number> = {
  BIKE: 0.6,
  AUTO: 0.85,
  SEDAN: 1.0,
  SUV: 1.4,
};

export interface FareEstimate {
  distanceKm: number;
  estimatedDurationMinutes: number;
  fare: number;
}

/**
 * Fare = Base Fare + (Distance × Per-KM Rate) + (Time × Per-Minute Rate),
 * scaled by a vehicle-type multiplier, floored at a configured minimum.
 * Time is *estimated* from distance / average speed — this project doesn't
 * integrate a real routing/traffic API, so it's a simplification worth
 * being explicit about.
 */
export function estimateFare(pickup: Coordinates, destination: Coordinates, vehicleType: VehicleType): FareEstimate {
  const distanceKm = haversineDistanceKm(pickup, destination);
  const estimatedDurationMinutes = (distanceKm / env.AVERAGE_SPEED_KMPH) * 60;

  const rawFare =
    env.FARE_BASE + distanceKm * env.FARE_PER_KM + estimatedDurationMinutes * env.FARE_PER_MINUTE;

  const fare = Math.max(rawFare * VEHICLE_MULTIPLIER[vehicleType], env.FARE_MINIMUM);

  return {
    distanceKm: round2(distanceKm),
    estimatedDurationMinutes: round2(estimatedDurationMinutes),
    fare: round2(fare),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
