import type { Geofence } from '../api/types'
import { EARTH_RADIUS_METERS } from '../geofence/distance'
import type { GeolocationFix } from '../hooks/useGeolocation'

/**
 * Reading builders for the development-only GPS test mode.
 *
 * These functions only *build* readings; they never classify, submit or store anything. Their
 * output is handed to the same evaluation and recording path a real browser fix travels, so a
 * simulated reading is validated by the frontend state machine and by the backend exactly like
 * a real one. The backend stays authoritative for distance, accuracy and geofence membership.
 *
 * The coordinates are derived from the geofence the API returned, so this module holds no copy
 * of the production target.
 */

/** Metres per degree of latitude. The meridian is near enough to constant for a test offset. */
const DEGREES_PER_METRE = 180 / Math.PI / EARTH_RADIUS_METERS

/** Accuracy a simulated reading reports, comfortably inside the 30 m policy threshold. */
export const SIMULATED_ACCURACY_METERS = 5

/** Multiples of the radius used for the outside reading, so it is unambiguously outside. */
export const OUTSIDE_RADIUS_MULTIPLIER = 4

/** A valid reading at the geofence centre reported by the API: a confirmed entry. */
export function insideReading(geofence: Geofence, occurredAt: number): GeolocationFix {
  return {
    latitude: geofence.latitude,
    longitude: geofence.longitude,
    accuracyMeters: SIMULATED_ACCURACY_METERS,
    occurredAt,
  }
}

/** A valid reading far outside the radius: a confirmed exit, never an entry. */
export function outsideReading(geofence: Geofence, occurredAt: number): GeolocationFix {
  return {
    latitude: geofence.latitude + geofence.radiusMeters * OUTSIDE_RADIUS_MULTIPLIER * DEGREES_PER_METRE,
    longitude: geofence.longitude,
    accuracyMeters: SIMULATED_ACCURACY_METERS,
    occurredAt,
  }
}

/**
 * A confirmed exit immediately followed by a re-entry, in evaluation order.
 *
 * Both readings share one observation time, so the second is not discarded as out of order.
 * The re-entry lands inside the backend's cooldown window, so it confirms an exit and moves the
 * machine back inside while the notification itself is throttled.
 */
export function exitThenReentry(geofence: Geofence, occurredAt: number): [GeolocationFix, GeolocationFix] {
  return [outsideReading(geofence, occurredAt), insideReading(geofence, occurredAt)]
}
