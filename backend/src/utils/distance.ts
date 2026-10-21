import { ValidationError } from './errors.js';
import { assertFiniteNumber } from './validation.js';

export interface Coordinates {
  latitude: number;
  longitude: number;
}

/** Mean Earth radius in metres; accurate enough for metre-scale distances. */
export const EARTH_RADIUS_METERS = 6371008.8;

/**
 * Floating-point tolerance used when comparing a measured distance with a radius.
 *
 * Haversine results are not exact multiples of a metre (a point constructed exactly
 * 30 m away can evaluate to 30.000000000000004), so a strictly `<= radius` comparison
 * would classify a point on the boundary as outside. The tolerance is one micrometre:
 * four orders of magnitude larger than the floating-point error at this scale, and
 * physically irrelevant next to consumer GPS accuracy.
 */
export const BOUNDARY_EPSILON_METERS = 1e-6;

/** Validates latitude/longitude ranges and numeric types, throwing on bad input. */
export function assertValidCoordinates(value: Coordinates): Coordinates {
  if (typeof value !== 'object' || value === null) {
    throw new ValidationError('coordinates must be an object with latitude and longitude');
  }

  const { latitude, longitude } = value;
  assertFiniteNumber(latitude, 'latitude');
  assertFiniteNumber(longitude, 'longitude');

  if (latitude < -90 || latitude > 90) {
    throw new ValidationError('latitude must be between -90 and 90 degrees');
  }

  if (longitude < -180 || longitude > 180) {
    throw new ValidationError('longitude must be between -180 and 180 degrees');
  }

  return value;
}

/** Great-circle distance between two points, in metres (Haversine formula). */
export function haversineMeters(from: Coordinates, to: Coordinates): number {
  assertValidCoordinates(from);
  assertValidCoordinates(to);

  const toRadians = Math.PI / 180;
  const lat1 = from.latitude * toRadians;
  const lat2 = to.latitude * toRadians;
  const deltaLat = lat2 - lat1;
  const deltaLon = (to.longitude - from.longitude) * toRadians;

  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;

  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(a)));
}
