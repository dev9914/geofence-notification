/**
 * Great-circle distance, implemented independently of the backend but with the same
 * constants and the same boundary rule, so the visitor sees the same classification the
 * server will compute when it validates the entry.
 *
 * The backend remains authoritative: it recomputes this distance from its own canonical
 * geofence coordinates and rejects a reading it disagrees with.
 */

export interface Coordinates {
  latitude: number
  longitude: number
}

/** Mean Earth radius in metres; accurate enough for metre-scale distances. */
export const EARTH_RADIUS_METERS = 6371008.8

/**
 * Floating-point tolerance used when comparing a measured distance with a radius.
 *
 * A point constructed exactly 30 m from the centre can evaluate to 30.000000000000004 m, so
 * a strict `<= radius` comparison would call a boundary point "outside". The tolerance is
 * one micrometre: far larger than the floating-point error at this scale, and physically
 * irrelevant next to consumer GPS accuracy.
 */
export const BOUNDARY_EPSILON_METERS = 1e-6

/** True for any finite number, including 0 and negatives. */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Latitude is a finite number within ±90 degrees. */
export function isValidLatitude(value: unknown): value is number {
  return isFiniteNumber(value) && value >= -90 && value <= 90
}

/** Longitude is a finite number within ±180 degrees. */
export function isValidLongitude(value: unknown): value is number {
  return isFiniteNumber(value) && value >= -180 && value <= 180
}

/** True when `value` is a usable coordinate pair. Never coerces strings or booleans. */
export function isValidCoordinates(value: unknown): value is Coordinates {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const { latitude, longitude } = value as Partial<Coordinates>

  return isValidLatitude(latitude) && isValidLongitude(longitude)
}

/**
 * Great-circle distance between two points in metres (Haversine formula).
 *
 * @throws {RangeError} when either point is not a usable coordinate pair.
 */
export function haversineMeters(from: Coordinates, to: Coordinates): number {
  if (!isValidCoordinates(from) || !isValidCoordinates(to)) {
    throw new RangeError('haversineMeters requires two valid coordinate pairs')
  }

  const toRadians = Math.PI / 180
  const lat1 = from.latitude * toRadians
  const lat2 = to.latitude * toRadians
  const deltaLat = lat2 - lat1
  const deltaLon = (to.longitude - from.longitude) * toRadians

  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2

  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(a)))
}

/**
 * Boundary test used for the inside/outside decision.
 *
 * A point exactly on the radius counts as inside, matching the backend.
 */
export function isWithinRadius(distanceMeters: number, radiusMeters: number): boolean {
  if (!isFiniteNumber(distanceMeters) || !isFiniteNumber(radiusMeters)) {
    return false
  }

  return distanceMeters <= radiusMeters + BOUNDARY_EPSILON_METERS
}
