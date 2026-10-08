import { describe, it, expect } from 'vitest';
import { haversineDistanceKm, isValidLatitude, isValidLongitude } from '../../src/utils/geo';

describe('haversineDistanceKm', () => {
  it('returns ~0 for the same point', () => {
    const p = { latitude: 22.3072, longitude: 73.1812 };
    expect(haversineDistanceKm(p, p)).toBeCloseTo(0, 5);
  });

  it('computes a known real-world distance reasonably accurately', () => {
    // Vadodara railway station ↔ Sayaji Baug, roughly a few km apart
    const a = { latitude: 22.3072, longitude: 73.1812 };
    const b = { latitude: 22.322, longitude: 73.1922 };
    const distance = haversineDistanceKm(a, b);
    expect(distance).toBeGreaterThan(1);
    expect(distance).toBeLessThan(5);
  });

  it('is symmetric (distance A→B equals B→A)', () => {
    const a = { latitude: 22.3072, longitude: 73.1812 };
    const b = { latitude: 22.322, longitude: 73.168 };
    expect(haversineDistanceKm(a, b)).toBeCloseTo(haversineDistanceKm(b, a), 10);
  });
});

describe('isValidLatitude / isValidLongitude', () => {
  it('accepts valid coordinates', () => {
    expect(isValidLatitude(22.3072)).toBe(true);
    expect(isValidLongitude(73.1812)).toBe(true);
    expect(isValidLatitude(-90)).toBe(true);
    expect(isValidLatitude(90)).toBe(true);
  });

  it('rejects out-of-range or non-finite values', () => {
    expect(isValidLatitude(91)).toBe(false);
    expect(isValidLatitude(-91)).toBe(false);
    expect(isValidLongitude(181)).toBe(false);
    expect(isValidLatitude(NaN)).toBe(false);
    expect(isValidLatitude(Infinity)).toBe(false);
  });
});
