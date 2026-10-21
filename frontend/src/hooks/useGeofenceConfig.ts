import { useCallback, useEffect, useState } from 'react'
import { fetchGeofences } from '../api/geofences'
import { describeConfigFailure, type FailureDescription } from '../api/failures'
import type { Geofence } from '../api/types'

/**
 * Loads the canonical geofence configuration (`GET /api/v1/geofences`).
 *
 * The frontend keeps no independent copy of the coordinates, radius or policy: everything
 * the tracking code uses comes from this response. Until it has loaded successfully the
 * geofence is `null`, and the tracking code refuses to classify readings.
 */

export type GeofenceConfigStatus = 'loading' | 'ready' | 'error'

export interface GeofenceConfigResult {
  status: GeofenceConfigStatus
  geofence: Geofence | null
  failure: FailureDescription | null
  /** Re-runs the request after a failure. */
  reload: () => void
}

const NO_GEOFENCE_FAILURE: FailureDescription = {
  code: 'NO_GEOFENCE',
  message: 'The geofence API returned no geofence configuration.',
  hint: 'Check the geofence registry on the backend, then retry.',
}

export function useGeofenceConfig(): GeofenceConfigResult {
  const [state, setState] = useState<{
    status: GeofenceConfigStatus
    geofence: Geofence | null
    failure: FailureDescription | null
  }>({ status: 'loading', geofence: null, failure: null })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    let active = true

    fetchGeofences({ signal: controller.signal })
      .then((geofences) => {
        if (!active) {
          return
        }

        const geofence = geofences[0]

        if (geofence === undefined) {
          setState({ status: 'error', geofence: null, failure: NO_GEOFENCE_FAILURE })
          return
        }

        setState({ status: 'ready', geofence, failure: null })
      })
      .catch((error: unknown) => {
        if (!active) {
          return
        }

        setState({ status: 'error', geofence: null, failure: describeConfigFailure(error) })
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [attempt])

  const reload = useCallback(() => {
    // Back to the loading state before the retry, so the page cannot show a stale failure.
    setState({ status: 'loading', geofence: null, failure: null })
    setAttempt((value) => value + 1)
  }, [])

  return { status: state.status, geofence: state.geofence, failure: state.failure, reload }
}
