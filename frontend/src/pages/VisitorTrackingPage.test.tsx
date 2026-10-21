import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import VisitorTrackingPage from './VisitorTrackingPage'
import { EARTH_RADIUS_METERS } from '../geofence/distance'
import { demoGeofence, geofenceListBody, jsonResponse, recordedBody } from '../test/fixtures'
import {
  GEO_PERMISSION_DENIED,
  GEO_POSITION_UNAVAILABLE,
  GEO_TIMEOUT,
  type GeolocationFix,
} from '../hooks/useGeolocation'
import type { CreateNotificationPayload } from '../api/types'

const DEGREES_PER_METRE = 180 / Math.PI / EARTH_RADIUS_METERS
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()

interface RegisteredWatch {
  success: PositionCallback
  error: PositionErrorCallback | null
}

let watches: RegisteredWatch[]
let clearedIds: number[]

function installGeolocation(): void {
  watches = []
  clearedIds = []
  let sequence = 0

  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      watchPosition(success: PositionCallback, error: PositionErrorCallback | null) {
        sequence += 1
        watches.push({ success, error })
        return sequence
      },
      clearWatch(id: number) {
        clearedIds.push(id)
      },
    },
  })
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

interface RouteOptions {
  geofences?: () => Promise<Response>
  notifications?: () => Promise<Response>
}

/** Routes the two calls the visitor page makes. */
function routeFetch(options: RouteOptions = {}): void {
  fetchMock.mockImplementation((input) => {
    const url = String(input)

    if (url.endsWith('/api/v1/geofences')) {
      return options.geofences?.() ?? Promise.resolve(jsonResponse(geofenceListBody()))
    }

    if (url.endsWith('/api/v1/notifications')) {
      return options.notifications?.() ?? Promise.resolve(jsonResponse(recordedBody()))
    }

    return Promise.reject(new Error(`Unexpected request: ${url}`))
  })
}

/** Bodies of every notification POST the page made. */
function postedEntries(): CreateNotificationPayload[] {
  return fetchMock.mock.calls
    .filter(([input, init]) => String(input).endsWith('/api/v1/notifications') && init?.method === 'POST')
    .map(([, init]) => JSON.parse(String(init?.body)) as CreateNotificationPayload)
}

/** A reading 10 m north of the canonical geofence centre: inside the 30 m radius. */
function insideFix(overrides: Partial<GeolocationFix> = {}): GeolocationFix {
  return {
    latitude: demoGeofence.latitude + 10 * DEGREES_PER_METRE,
    longitude: demoGeofence.longitude,
    accuracyMeters: 5,
    occurredAt: Date.now(),
    ...overrides,
  }
}

async function startTracking(): Promise<void> {
  await userEvent.click(await screen.findByRole('button', { name: /start tracking/i }))
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  installGeolocation()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('VisitorTrackingPage', () => {
  it('shows a loading state until the geofence configuration arrives', () => {
    routeFetch({ geofences: () => new Promise<Response>(() => {}) })

    render(<VisitorTrackingPage />)

    expect(screen.getByRole('status')).toHaveTextContent(/Loading geofence configuration/)
    expect(screen.queryByRole('button', { name: /start tracking/i })).not.toBeInTheDocument()
  })

  it('renders the geofence the backend reports and offers tracking', async () => {
    routeFetch()

    render(<VisitorTrackingPage />)

    expect(await screen.findByRole('button', { name: /start tracking/i })).toBeInTheDocument()
    expect(screen.getByText(demoGeofence.name)).toBeInTheDocument()
    expect(screen.getByText(demoGeofence.id)).toBeInTheDocument()
    // Radius and accuracy threshold both come from the API, not from a local constant.
    expect(screen.getAllByText('30 m').length).toBeGreaterThan(0)
    expect(screen.getByText('60 s')).toBeInTheDocument()
  })

  it('offers a recoverable error when the geofence API is unavailable', async () => {
    routeFetch({ geofences: () => Promise.reject(new TypeError('Failed to fetch')) })

    render(<VisitorTrackingPage />)

    expect(await screen.findByRole('alert')).toHaveTextContent(/Geofence configuration unavailable/)
    expect(screen.queryByRole('button', { name: /start tracking/i })).not.toBeInTheDocument()

    routeFetch()
    await userEvent.click(screen.getByRole('button', { name: /retry/i }))

    expect(await screen.findByRole('button', { name: /start tracking/i })).toBeInTheDocument()
  })

  it('records a confirmed entry with the exact payload and waits for the backend', async () => {
    routeFetch()

    render(<VisitorTrackingPage />)
    await startTracking()

    expect(watches).toHaveLength(1)
    expect(screen.getByText(/Waiting for permission/)).toBeInTheDocument()

    const fix = insideFix()

    act(() => {
      watches[0].success(position(fix))
    })

    expect(await screen.findByText(/Entry recorded by the backend/)).toBeInTheDocument()
    expect(screen.getByText(/Inside the geofence/)).toBeInTheDocument()

    const entries = postedEntries()

    expect(entries).toHaveLength(1)
    expect(Object.keys(entries[0]).sort()).toEqual([
      'accuracyMeters',
      'eventId',
      'geofenceId',
      'latitude',
      'longitude',
      'occurredAt',
      'sessionId',
    ])
    expect(entries[0].eventId).toMatch(UUID)
    expect(entries[0].geofenceId).toBe(demoGeofence.id)
    expect(entries[0].latitude).toBeCloseTo(fix.latitude, 10)
    expect(entries[0].longitude).toBeCloseTo(fix.longitude, 10)
    expect(entries[0].accuracyMeters).toBe(5)
    expect(entries[0].occurredAt).toBe(fix.occurredAt)
    expect(entries[0].sessionId.length).toBeGreaterThan(0)
  })

  it('submits only one entry for repeated inside readings', async () => {
    routeFetch()

    render(<VisitorTrackingPage />)
    await startTracking()

    act(() => {
      watches[0].success(position(insideFix()))
    })
    await screen.findByText(/Entry recorded by the backend/)

    act(() => {
      watches[0].success(position(insideFix()))
      watches[0].success(position(insideFix()))
    })

    expect(postedEntries()).toHaveLength(1)
    expect(screen.getByText(/no new notification is sent/)).toBeInTheDocument()
  })

  it('never notifies from an uncertain reading while inside', async () => {
    routeFetch()

    render(<VisitorTrackingPage />)
    await startTracking()

    act(() => {
      watches[0].success(position(insideFix({ accuracyMeters: 45 })))
    })

    expect(await screen.findByText(/Uncertain position/)).toBeInTheDocument()
    expect(screen.getByText(/Low GPS accuracy/)).toBeInTheDocument()
    expect(postedEntries()).toHaveLength(0)
  })

  it('does not notify for a reading outside the radius', async () => {
    routeFetch()

    render(<VisitorTrackingPage />)
    await startTracking()

    act(() => {
      // 120 m out: a usable reading that is a confirmed exit, not an entry.
      watches[0].success(position(insideFix({ latitude: demoGeofence.latitude + 120 * DEGREES_PER_METRE })))
    })

    expect(
      await screen.findByText(/Your reported position is outside the geofence radius/),
    ).toBeInTheDocument()
    expect(postedEntries()).toHaveLength(0)
  })

  it('reports a denied location permission', async () => {
    routeFetch()

    render(<VisitorTrackingPage />)
    await startTracking()

    act(() => {
      watches[0].error?.(positionError(GEO_PERMISSION_DENIED))
    })

    expect(await screen.findByText(/Location permission denied/)).toBeInTheDocument()
    expect(postedEntries()).toHaveLength(0)
  })

  it('reports a location error without claiming an entry', async () => {
    routeFetch()

    render(<VisitorTrackingPage />)
    await startTracking()

    act(() => {
      watches[0].error?.(positionError(GEO_POSITION_UNAVAILABLE))
    })

    expect(await screen.findByText(/Location unavailable/)).toBeInTheDocument()
    expect(postedEntries()).toHaveLength(0)
  })

  it('reports a persistence failure instead of a success', async () => {
    routeFetch({
      notifications: () =>
        Promise.resolve(
          jsonResponse({ status: 'error', error: { code: 'DATABASE_UNAVAILABLE', message: 'Down' } }, 503),
        ),
    })

    render(<VisitorTrackingPage />)
    await startTracking()

    act(() => {
      watches[0].success(position(insideFix()))
    })

    const failure = await screen.findByRole('alert')

    expect(failure).toHaveTextContent(/Notification could not be saved/)
    expect(failure).toHaveTextContent(/not saved/)
    expect(screen.queryByText(/Entry recorded by the backend/)).not.toBeInTheDocument()
  })

  it('releases the watcher when the page unmounts while tracking', async () => {
    routeFetch()

    const { unmount } = render(<VisitorTrackingPage />)
    await startTracking()

    expect(clearedIds).toEqual([])

    unmount()

    expect(clearedIds).toEqual([1])
  })

  it('releases the watcher when tracking is stopped', async () => {
    routeFetch()

    render(<VisitorTrackingPage />)
    await startTracking()

    await userEvent.click(screen.getByRole('button', { name: /stop tracking/i }))

    expect(clearedIds).toEqual([1])
    expect(screen.getByText(/Tracking is stopped/)).toBeInTheDocument()
  })
})
