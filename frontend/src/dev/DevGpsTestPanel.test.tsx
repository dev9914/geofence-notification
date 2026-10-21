import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import VisitorTrackingPage from '../pages/VisitorTrackingPage'
import { OUTSIDE_RADIUS_MULTIPLIER, SIMULATED_ACCURACY_METERS } from './simulatedReadings'
import { demoGeofence, geofenceListBody, jsonResponse, recordedBody } from '../test/fixtures'
import type { CreateNotificationPayload } from '../api/types'

/**
 * The development GPS test mode is exercised through the real visitor page, so these tests show
 * that a simulated reading is evaluated by the same state machine and submitted through the same
 * notification API as a browser GPS fix.
 *
 * Only `GET /api/v1/geofences` and `POST /api/v1/notifications` are routed: the simulated
 * controls never start the browser watcher.
 */

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()

interface RouteOptions {
  notifications?: () => Promise<Response>
}

function routeFetch(options: RouteOptions = {}): void {
  fetchMock.mockImplementation((input) => {
    const url = String(input)

    if (url.endsWith('/api/v1/geofences')) {
      return Promise.resolve(jsonResponse(geofenceListBody()))
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
    .filter(
      ([input, init]) =>
        String(input).endsWith('/api/v1/notifications') && init?.method === 'POST',
    )
    .map(([, init]) => JSON.parse(String(init?.body)) as CreateNotificationPayload)
}

function testModeRegion(): HTMLElement | null {
  return screen.queryByRole('region', { name: /Development GPS test mode/i })
}

async function clickSimulate(name: RegExp): Promise<void> {
  await userEvent.click(await screen.findByRole('button', { name }))
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('development GPS test mode', () => {
  it('is offered in a development build', async () => {
    routeFetch()

    render(<VisitorTrackingPage />)

    expect(await screen.findByRole('region', { name: /Development GPS test mode/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /simulate outside reading/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /simulate inside reading/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /simulate exit then re-entry/i })).toBeInTheDocument()
    // The real GPS controls are still the primary ones.
    expect(screen.getByRole('button', { name: /start tracking/i })).toBeInTheDocument()
  })

  it('cannot be enabled in a production build', async () => {
    vi.stubEnv('DEV', false)
    routeFetch()

    render(<VisitorTrackingPage />)

    // The page itself still works; only the test controls are gone.
    expect(await screen.findByRole('button', { name: /start tracking/i })).toBeInTheDocument()
    expect(screen.getByText(demoGeofence.name)).toBeInTheDocument()
    expect(testModeRegion()).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /simulate/i })).not.toBeInTheDocument()
  })

  it('applies an outside reading without recording a notification', async () => {
    routeFetch()

    render(<VisitorTrackingPage />)
    await clickSimulate(/simulate outside reading/i)

    expect(await screen.findByText('Outside the geofence')).toBeInTheDocument()
    expect(screen.getByText(/Your reported position is outside the geofence radius/)).toBeInTheDocument()
    expect(postedEntries()).toHaveLength(0)
    // The reading is marked as a test reading rather than presented as real GPS.
    expect(
      screen.getByText(/Simulated reading from the development GPS test mode/),
    ).toBeInTheDocument()
  })

  it('records a simulated entry with the existing payload contract', async () => {
    routeFetch()

    render(<VisitorTrackingPage />)
    await clickSimulate(/simulate inside reading/i)

    expect(await screen.findByText(/Entry recorded by the backend/)).toBeInTheDocument()
    expect(screen.getByText('Inside the geofence')).toBeInTheDocument()

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
    // The coordinates come from the geofence the API returned, not from a frontend constant.
    expect(entries[0].latitude).toBe(demoGeofence.latitude)
    expect(entries[0].longitude).toBe(demoGeofence.longitude)
    expect(entries[0].accuracyMeters).toBe(SIMULATED_ACCURACY_METERS)
    expect(entries[0].geofenceId).toBe(demoGeofence.id)
    expect(entries[0].occurredAt).toBeLessThanOrEqual(Date.now())
  })

  it('submits only one entry for repeated inside readings', async () => {
    routeFetch()

    render(<VisitorTrackingPage />)
    await clickSimulate(/simulate inside reading/i)
    await screen.findByText(/Entry recorded by the backend/)

    await clickSimulate(/simulate inside reading/i)
    await clickSimulate(/simulate inside reading/i)

    expect(postedEntries()).toHaveLength(1)
    expect(screen.getByText(/no new notification is sent/)).toBeInTheDocument()
  })

  it('confirms an exit and then throttles the immediate re-entry', async () => {
    routeFetch()

    render(<VisitorTrackingPage />)
    await clickSimulate(/simulate inside reading/i)
    await screen.findByText(/Entry recorded by the backend/)

    await clickSimulate(/simulate exit then re-entry/i)

    // The re-entry is only throttled if the exit in between was confirmed, which is what makes
    // this different from a duplicate inside reading.
    expect(screen.getByText(/this entry is throttled/)).toBeInTheDocument()
    expect(screen.queryByText(/no new notification is sent/)).not.toBeInTheDocument()
    expect(screen.getByText('Inside the geofence')).toBeInTheDocument()
    expect(postedEntries()).toHaveLength(1)
  })

  it('surfaces the API error when the backend rejects the event', async () => {
    routeFetch({
      notifications: () =>
        Promise.resolve(
          jsonResponse(
            {
              status: 'error',
              error: {
                code: 'VALIDATION_ERROR',
                message: 'accuracyMeters: expected a finite number',
              },
            },
            400,
          ),
        ),
    })

    render(<VisitorTrackingPage />)
    await clickSimulate(/simulate inside reading/i)

    const failure = await screen.findByRole('alert')

    expect(failure).toHaveTextContent(/Notification could not be saved/)
    expect(failure).toHaveTextContent(/accuracyMeters: expected a finite number/)
    expect(screen.queryByText(/Entry recorded by the backend/)).not.toBeInTheDocument()
  })

  it('reports the outside reading distance using the API radius', async () => {
    routeFetch()

    render(<VisitorTrackingPage />)
    await clickSimulate(/simulate outside reading/i)

    const expectedMetres = demoGeofence.radiusMeters * OUTSIDE_RADIUS_MULTIPLIER

    expect(
      await screen.findByText(`${expectedMetres.toFixed(1)} m`),
    ).toBeInTheDocument()
    expect(screen.getByText(/\(radius 30.0 m\)/)).toBeInTheDocument()
  })
})
