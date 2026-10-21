import { apiRequest } from './client'
import { parseGeofenceList } from './contract'
import type { Geofence } from './types'

/**
 * `GET /api/v1/geofences`
 *
 * Returns the canonical geofence(s) configured on the backend: coordinates, radius, enabled
 * status and the visitor policy. The frontend never keeps its own copy of those values.
 */
export function fetchGeofences(options: { signal?: AbortSignal } = {}): Promise<Geofence[]> {
  return apiRequest('/api/v1/geofences', parseGeofenceList, { signal: options.signal })
}
