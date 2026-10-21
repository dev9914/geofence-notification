import { describe, expect, it } from 'vitest';
import { DEFAULT_GEOFENCE } from '../config/geofence.js';
import { ValidationError } from './errors.js';
import { EARTH_RADIUS_METERS, haversineMeters, type Coordinates } from './distance.js';

const CENTER: Coordinates = {
  latitude: DEFAULT_GEOFENCE.latitude,
  longitude: DEFAULT_GEOFENCE.longitude,
};

/** Point due north of `origin` at `meters`, using the same Earth radius as the implementation. */
function pointNorthOf(origin: Coordinates, meters: number): Coordinates {
  return {
    latitude: origin.latitude + (meters / EARTH_RADIUS_METERS) * (180 / Math.PI),
    longitude: origin.longitude,
  };
}

describe('haversineMeters', () => {
  it('returns zero for identical coordinates', () => {
    expect(haversineMeters(CENTER, { ...CENTER })).toBe(0);
  });

  it('matches a known coordinate pair: one degree of longitude on the equator', () => {
    const distance = haversineMeters({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 });

    // 111195.08 m for a mean Earth radius of 6371008.8 m.
    expect(distance).toBeGreaterThan(111195);
    expect(distance).toBeLessThan(111196);
  });

  it('matches a known coordinate pair: a quarter of the equator', () => {
    const distance = haversineMeters({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 90 });

    // R * pi / 2 = 10007557.26 m.
    expect(distance).toBeGreaterThan(10007557);
    expect(distance).toBeLessThan(10007558);
  });

  it('is symmetric and measures a 30 metre offset as 30 metres', () => {
    const boundary = pointNorthOf(CENTER, 30);

    expect(haversineMeters(CENTER, boundary)).toBeCloseTo(30, 6);
    expect(haversineMeters(boundary, CENTER)).toBeCloseTo(haversineMeters(CENTER, boundary), 12);
  });

  it('rejects out-of-range coordinates', () => {
    expect(() => haversineMeters(CENTER, { latitude: 90.0001, longitude: 0 })).toThrow(ValidationError);
    expect(() => haversineMeters(CENTER, { latitude: -90.0001, longitude: 0 })).toThrow(ValidationError);
    expect(() => haversineMeters(CENTER, { latitude: 0, longitude: 180.0001 })).toThrow(ValidationError);
    expect(() => haversineMeters(CENTER, { latitude: 0, longitude: -180.0001 })).toThrow(ValidationError);
  });

  it('rejects non-finite coordinates', () => {
    expect(() => haversineMeters(CENTER, { latitude: Number.NaN, longitude: 0 })).toThrow(ValidationError);
    expect(() =>
      haversineMeters(CENTER, { latitude: 0, longitude: Number.POSITIVE_INFINITY }),
    ).toThrow(ValidationError);
  });

  it('rejects string coordinates instead of coercing them', () => {
    const stringLatitude = { latitude: '18.5', longitude: 73.9 } as unknown as Coordinates;

    expect(() => haversineMeters(CENTER, stringLatitude)).toThrow(ValidationError);
  });

  it('rejects non-object input', () => {
    expect(() => haversineMeters(CENTER, null as unknown as Coordinates)).toThrow(ValidationError);
  });
});
