import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Browser geolocation watcher.
 *
 * Wraps `navigator.geolocation.watchPosition` with high accuracy, a bounded timeout and a
 * bounded cached-position age, and guarantees that an active watcher is always released with
 * `clearWatch`: when tracking stops, when the component unmounts, and when the page is
 * hidden.
 *
 * There is no simulated fallback: if the browser cannot provide a position, the hook reports
 * why instead of inventing coordinates.
 */

export type GeolocationStatus =
  | 'idle'
  | 'waiting'
  | 'tracking'
  | 'unsupported'
  | 'denied'
  | 'timeout'
  | 'unavailable'
  | 'geolocation-error'

/** A position exactly as the browser reported it. */
export interface GeolocationFix {
  latitude: number
  longitude: number
  accuracyMeters: number
  /** `Position.timestamp`: when the fix was acquired, in epoch milliseconds. */
  occurredAt: number
}

/** `GeolocationPositionError` codes, as named constants so they are readable in tests. */
export const GEO_PERMISSION_DENIED = 1
export const GEO_POSITION_UNAVAILABLE = 2
export const GEO_TIMEOUT = 3

/** High accuracy is required for a 30 m radius; the browser must not return stale fixes. */
export const WATCH_OPTIONS: PositionOptions = Object.freeze({
  enableHighAccuracy: true,
  timeout: 15_000,
  maximumAge: 5_000,
})

export const GEOLOCATION_UNSUPPORTED_MESSAGE =
  'This browser does not support the Geolocation API, so location tracking cannot start.'

export const GEOLOCATION_DENIED_MESSAGE =
  'Location permission was denied. Allow location access for this site, then start tracking again.'

export const GEOLOCATION_UNAVAILABLE_MESSAGE =
  'The device could not determine a position. Check that location services are switched on.'

export const GEOLOCATION_TIMEOUT_MESSAGE =
  'No GPS fix arrived in time. Move to a clearer view of the sky and keep tracking.'

export const GEOLOCATION_ERROR_MESSAGE =
  'Location tracking stopped because of an unexpected geolocation error.'

/** True when the browser exposes the Geolocation API. */
export function supportsGeolocation(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'geolocation' in navigator &&
    navigator.geolocation !== null &&
    navigator.geolocation !== undefined
  )
}

/**
 * True when the page runs in a secure context.
 *
 * Geolocation is only granted on HTTPS or on localhost; on a plain-HTTP origin the browser
 * reports a permission error that has nothing to do with the user's choice.
 */
export function isSecureContextAvailable(): boolean {
  return globalThis.isSecureContext !== false
}

export interface UseGeolocationOptions {
  /** Called for every position the browser reports. */
  onFix?: (fix: GeolocationFix) => void
}

export interface UseGeolocationResult {
  status: GeolocationStatus
  /** Most recent position, kept after tracking stops so the last reading stays visible. */
  fix: GeolocationFix | null
  /** True while a watcher is registered. */
  isTracking: boolean
  start: () => void
  stop: () => void
}

function statusForErrorCode(code: number): GeolocationStatus {
  switch (code) {
    case GEO_PERMISSION_DENIED:
      return 'denied'
    case GEO_POSITION_UNAVAILABLE:
      return 'unavailable'
    case GEO_TIMEOUT:
      return 'timeout'
    default:
      return 'geolocation-error'
  }
}

export function useGeolocation(options: UseGeolocationOptions = {}): UseGeolocationResult {
  const { onFix } = options
  const [status, setStatus] = useState<GeolocationStatus>(() =>
    supportsGeolocation() ? 'idle' : 'unsupported',
  )
  const [fix, setFix] = useState<GeolocationFix | null>(null)
  const [isTracking, setIsTracking] = useState(false)

  const watchIdRef = useRef<number | null>(null)
  const onFixRef = useRef(onFix)

  useEffect(() => {
    onFixRef.current = onFix
  }, [onFix])

  /** Releases the active watcher, if any. Safe to call repeatedly. */
  const clearActiveWatch = useCallback(() => {
    const watchId = watchIdRef.current

    if (watchId === null) {
      return
    }

    watchIdRef.current = null
    navigator.geolocation.clearWatch(watchId)
  }, [])

  const handlePosition = useCallback((position: GeolocationPosition) => {
    const next: GeolocationFix = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracyMeters: position.coords.accuracy,
      occurredAt: position.timestamp,
    }

    setFix(next)
    setStatus('tracking')
    onFixRef.current?.(next)
  }, [])

  const handleError = useCallback(
    (error: GeolocationPositionError) => {
      const nextStatus = statusForErrorCode(error.code)

      // A denied permission cannot recover without user action, so the watcher is released.
      if (nextStatus === 'denied') {
        clearActiveWatch()
        setIsTracking(false)
      }

      setStatus(nextStatus)
    },
    [clearActiveWatch],
  )

  const start = useCallback(() => {
    // Guard against a second watcher when Start is clicked repeatedly.
    if (watchIdRef.current !== null) {
      return
    }

    if (!supportsGeolocation()) {
      setStatus('unsupported')
      setIsTracking(false)
      return
    }

    setStatus('waiting')
    setIsTracking(true)
    watchIdRef.current = navigator.geolocation.watchPosition(
      handlePosition,
      handleError,
      WATCH_OPTIONS,
    )
  }, [handleError, handlePosition])

  const stop = useCallback(() => {
    clearActiveWatch()
    setIsTracking(false)
    setStatus((current) => (current === 'unsupported' ? 'unsupported' : 'idle'))
  }, [clearActiveWatch])

  // Release the watcher when the component unmounts or the page is hidden.
  useEffect(() => {
    const handlePageHide = () => clearActiveWatch()

    window.addEventListener('pagehide', handlePageHide)

    return () => {
      window.removeEventListener('pagehide', handlePageHide)
      clearActiveWatch()
    }
  }, [clearActiveWatch])

  return { status, fix, isTracking, start, stop }
}
