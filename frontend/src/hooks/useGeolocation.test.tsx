import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GEO_PERMISSION_DENIED,
  GEO_POSITION_UNAVAILABLE,
  GEO_TIMEOUT,
  WATCH_OPTIONS,
  useGeolocation,
  type GeolocationFix,
} from './useGeolocation'

/**
 * The browser's Geolocation API is mocked here and only here: the production code path calls
 * the real `navigator.geolocation.watchPosition`, and no simulated coordinates exist in the
 * application itself.
 */

interface RegisteredWatch {
  success: PositionCallback
  error: PositionErrorCallback | null
  options: PositionOptions | undefined
}

let watches: RegisteredWatch[]
let clearedIds: number[]
let watchSequence: number

function installGeolocation(): void {
  watches = []
  clearedIds = []
  watchSequence = 0

  const geolocation = {
    watchPosition(
      success: PositionCallback,
      error: PositionErrorCallback | null,
      options?: PositionOptions,
    ) {
      watchSequence += 1
      watches.push({ success, error, options })
      return watchSequence
    },
    clearWatch(id: number) {
      clearedIds.push(id)
    },
  }

  Object.defineProperty(navigator, 'geolocation', { value: geolocation, configurable: true })
}

function removeGeolocation(): void {
  Object.defineProperty(navigator, 'geolocation', { value: undefined, configurable: true })
}

function position(fix: GeolocationFix): GeolocationPosition {
  return {
    coords: {
      latitude: fix.latitude,
      longitude: fix.longitude,
      accuracy: fix.accuracyMeters,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
    },
    timestamp: fix.occurredAt,
  } as unknown as GeolocationPosition
}

function positionError(code: number): GeolocationPositionError {
  return {
    code,
    message: 'simulated geolocation error',
    PERMISSION_DENIED: GEO_PERMISSION_DENIED,
    POSITION_UNAVAILABLE: GEO_POSITION_UNAVAILABLE,
    TIMEOUT: GEO_TIMEOUT,
  }
}

const fix: GeolocationFix = {
  latitude: 18.56791,
  longitude: 73.91933,
  accuracyMeters: 5,
  occurredAt: 1_700_000_000_000,
}

describe('useGeolocation', () => {
  beforeEach(() => {
    installGeolocation()
  })

  it('starts one high-accuracy watcher and reports the browser-provided fix', () => {
    const onFix = vi.fn()
    const { result } = renderHook(() => useGeolocation({ onFix }))

    expect(result.current.status).toBe('idle')
    expect(result.current.isTracking).toBe(false)

    act(() => {
      result.current.start()
    })

    expect(watches).toHaveLength(1)
    expect(watches[0].options).toEqual(WATCH_OPTIONS)
    expect(watches[0].options?.enableHighAccuracy).toBe(true)
    expect(watches[0].options?.maximumAge).toBe(5_000)
    expect(result.current.status).toBe('waiting')
    expect(result.current.isTracking).toBe(true)

    act(() => {
      watches[0].success(position(fix))
    })

    expect(result.current.status).toBe('tracking')
    expect(result.current.fix).toEqual(fix)
    expect(onFix).toHaveBeenCalledWith(fix)
  })

  it('does not register a second watcher when Start is pressed repeatedly', () => {
    const { result } = renderHook(() => useGeolocation())

    act(() => {
      result.current.start()
    })
    act(() => {
      result.current.start()
    })
    act(() => {
      result.current.start()
    })

    expect(watches).toHaveLength(1)
  })

  it('always releases the active watcher when tracking stops', () => {
    const { result } = renderHook(() => useGeolocation())

    act(() => {
      result.current.start()
    })
    act(() => {
      result.current.stop()
    })

    expect(clearedIds).toEqual([1])
    expect(result.current.isTracking).toBe(false)
    expect(result.current.status).toBe('idle')

    // Stopping twice must not clear the same watcher again.
    act(() => {
      result.current.stop()
    })
    expect(clearedIds).toEqual([1])
  })

  it('can start a new watcher after stopping', () => {
    const { result } = renderHook(() => useGeolocation())

    act(() => {
      result.current.start()
    })
    act(() => {
      result.current.stop()
    })
    act(() => {
      result.current.start()
    })

    expect(watches).toHaveLength(2)
    expect(result.current.isTracking).toBe(true)
  })

  it('releases the watcher when the component unmounts', () => {
    const { result, unmount } = renderHook(() => useGeolocation())

    act(() => {
      result.current.start()
    })

    unmount()

    expect(clearedIds).toEqual([1])
  })

  it('releases the watcher when the page is hidden', () => {
    const { result } = renderHook(() => useGeolocation())

    act(() => {
      result.current.start()
    })
    act(() => {
      window.dispatchEvent(new Event('pagehide'))
    })

    expect(clearedIds).toEqual([1])
  })

  it('reports a denied permission and stops watching', () => {
    const { result } = renderHook(() => useGeolocation())

    act(() => {
      result.current.start()
    })
    act(() => {
      watches[0].error?.(positionError(GEO_PERMISSION_DENIED))
    })

    expect(result.current.status).toBe('denied')
    expect(result.current.isTracking).toBe(false)
    expect(clearedIds).toEqual([1])
    expect(result.current.fix).toBeNull()
  })

  it('reports an unavailable position but keeps watching', () => {
    const { result } = renderHook(() => useGeolocation())

    act(() => {
      result.current.start()
    })
    act(() => {
      watches[0].error?.(positionError(GEO_POSITION_UNAVAILABLE))
    })

    expect(result.current.status).toBe('unavailable')
    expect(result.current.isTracking).toBe(true)
    expect(result.current.fix).toBeNull()
  })

  it('reports a timeout but keeps watching', () => {
    const { result } = renderHook(() => useGeolocation())

    act(() => {
      result.current.start()
    })
    act(() => {
      watches[0].error?.(positionError(GEO_TIMEOUT))
    })

    expect(result.current.status).toBe('timeout')
    expect(result.current.isTracking).toBe(true)
  })

  it('reports an unsupported browser and never registers a watcher', () => {
    removeGeolocation()

    const { result } = renderHook(() => useGeolocation())

    expect(result.current.status).toBe('unsupported')

    act(() => {
      result.current.start()
    })

    expect(watches).toHaveLength(0)
    expect(result.current.status).toBe('unsupported')
    expect(result.current.isTracking).toBe(false)
  })
})
