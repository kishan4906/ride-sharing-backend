import { describe, it, expect } from 'vitest';
import { estimateFare } from '../../src/services/fare.service';

const pickup = { latitude: 22.3072, longitude: 73.1812 };
const destination = { latitude: 22.322, longitude: 73.1922 };

describe('estimateFare', () => {
  it('returns a positive fare, distance, and duration', () => {
    const result = estimateFare(pickup, destination, 'SEDAN');
    expect(result.distanceKm).toBeGreaterThan(0);
    expect(result.estimatedDurationMinutes).toBeGreaterThan(0);
    expect(result.fare).toBeGreaterThan(0);
  });

  it('never returns less than the configured minimum fare', () => {
    // Same pickup/destination → ~0 distance → should still floor at FARE_MINIMUM
    const result = estimateFare(pickup, pickup, 'BIKE');
    expect(result.fare).toBeGreaterThanOrEqual(60); // matches FARE_MINIMUM default in .env.example
  });

  it('charges more for a larger vehicle type over the same trip', () => {
    const bike = estimateFare(pickup, destination, 'BIKE');
    const suv = estimateFare(pickup, destination, 'SUV');
    expect(suv.fare).toBeGreaterThan(bike.fare);
  });

  it('charges more for a longer distance at the same vehicle type', () => {
    const shortTrip = estimateFare(pickup, { latitude: 22.308, longitude: 73.182 }, 'SEDAN');
    const longTrip = estimateFare(pickup, { latitude: 22.6, longitude: 73.4 }, 'SEDAN');
    expect(longTrip.fare).toBeGreaterThan(shortTrip.fare);
  });
});
