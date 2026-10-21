import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AdminDashboardPage from './AdminDashboardPage'
import {
  demoGeofence,
  demoSessionId,
  geofenceListBody,
  jsonResponse,
  notificationHistoryBody,
  recordedEvent,
  statsBody,
} from '../test/fixtures'

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()

interface RouteOptions {
  geofences?: () => Promise<Response>
  stats?: () => Promise<Response>
  history?: () => Promise<Response>
}

/** Routes the three read calls the dashboard makes. */
function routeFetch(options: RouteOptions = {}): void {
  fetchMock.mockImplementation((input) => {
    const url = String(input)

    if (url.endsWith('/api/v1/geofences')) {
      return options.geofences?.() ?? Promise.resolve(jsonResponse(geofenceListBody()))
    }

    if (url.endsWith('/api/v1/notifications/stats')) {
      return options.stats?.() ?? Promise.resolve(jsonResponse(statsBody()))
    }

    if (url.includes('/api/v1/notifications')) {
      return options.history?.() ?? Promise.resolve(jsonResponse(notificationHistoryBody()))
    }

    return Promise.reject(new Error(`Unexpected request: ${url}`))
  })
}

/** Number of requests whose URL contains `fragment`. */
function requestCount(fragment: string): number {
  return fetchMock.mock.calls.filter(([input]) => String(input).includes(fragment)).length
}

/** The health check the dashboard reaches for first, used to await the initial load. */
async function awaitFirstLoad(): Promise<void> {
  await screen.findByRole('table')
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('AdminDashboardPage', () => {
  it('shows a loading skeleton until every request answers', () => {
    routeFetch({ geofences: () => new Promise<Response>(() => {}) })

    render(<AdminDashboardPage />)

    expect(screen.getByRole('status')).toHaveTextContent(/Loading dashboard/)
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByText(demoGeofence.name)).not.toBeInTheDocument()
  })

  it('renders the summary and history exactly as the API reports them', async () => {
    routeFetch({ stats: () => Promise.resolve(jsonResponse(statsBody(42, recordedEvent.occurredAt))) })

    render(<AdminDashboardPage />)
    await awaitFirstLoad()

    // Totals come from the stats endpoint, not from a local constant.
    expect(screen.getByText('42')).toBeInTheDocument()
    expect(
      screen.getAllByText(new Date(recordedEvent.occurredAt).toLocaleString()).length,
    ).toBeGreaterThan(0)

    // The geofence configuration comes from the geofences endpoint.
    expect(screen.getByText(demoGeofence.name)).toBeInTheDocument()
    expect(screen.getAllByText(demoGeofence.id).length).toBeGreaterThan(0)

    // History row values come from the notification event.
    expect(screen.getByText('4.2 m')).toBeInTheDocument()
    expect(screen.getByText(demoSessionId)).toBeInTheDocument()
    expect(screen.getByText('18.567910, 73.919330')).toBeInTheDocument()
    expect(screen.getByText('accuracy ±5.0 m')).toBeInTheDocument()

    // History is requested through the typed client with a bounded page size.
    expect(requestCount('/api/v1/notifications?limit=20')).toBe(1)
  })

  it('renders an empty history and a null latest timestamp safely', async () => {
    routeFetch({
      stats: () => Promise.resolve(jsonResponse(statsBody(0, null))),
      history: () => Promise.resolve(jsonResponse(notificationHistoryBody([], { total: 0, count: 0 }))),
    })

    render(<AdminDashboardPage />)

    expect(await screen.findByText('No notifications recorded yet')).toBeInTheDocument()
    expect(screen.getByText('No notifications yet')).toBeInTheDocument()
    expect(screen.getByText('0')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('surfaces a retryable error and recovers when the API comes back', async () => {
    routeFetch({ stats: () => Promise.reject(new TypeError('Failed to fetch')) })

    render(<AdminDashboardPage />)

    const alert = await screen.findByRole('alert')

    expect(alert).toHaveTextContent(/Dashboard data unavailable/)
    expect(alert).toHaveTextContent(/could not be loaded/)
    expect(screen.queryByRole('table')).not.toBeInTheDocument()

    routeFetch()
    await userEvent.click(screen.getByRole('button', { name: /retry/i }))

    expect(await screen.findByRole('table')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('reports a response that violates the contract instead of crashing', async () => {
    // `latestNotificationAt` is required by the contract (nullable, but present).
    routeFetch({
      stats: () => Promise.resolve(jsonResponse({ status: 'ok', data: { totalEvents: 3 } })),
    })

    render(<AdminDashboardPage />)

    const alert = await screen.findByRole('alert')

    expect(alert).toHaveTextContent(/unexpected response/)
    expect(alert).not.toHaveTextContent(/NaN|undefined/)
  })

  it('offers no write controls and states that the view is read-only', async () => {
    routeFetch()

    render(<AdminDashboardPage />)
    await awaitFirstLoad()

    expect(screen.getByText(/This dashboard is read-only/)).toBeInTheDocument()
    // The only control is Refresh: the API has no write endpoints for geofence settings.
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.getByRole('button')).toHaveAccessibleName(/refresh/i)
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('refetches on refresh and stamps the last refreshed time', async () => {
    routeFetch({ stats: () => Promise.resolve(jsonResponse(statsBody(1, null))) })

    render(<AdminDashboardPage />)
    await awaitFirstLoad()

    expect(screen.getByText(/Last refreshed:/).textContent).not.toContain('—')

    const callsBefore = requestCount('/api/v1/notifications/stats')

    routeFetch({ stats: () => Promise.resolve(jsonResponse(statsBody(7, null))) })
    await userEvent.click(screen.getByRole('button', { name: /refresh/i }))

    expect(await screen.findByText('7')).toBeInTheDocument()
    expect(requestCount('/api/v1/notifications/stats')).toBeGreaterThan(callsBefore)
  })

  it('keeps the previous figures and warns when a refresh fails', async () => {
    routeFetch()

    render(<AdminDashboardPage />)
    await awaitFirstLoad()

    routeFetch({
      geofences: () =>
        Promise.resolve(
          jsonResponse(
            { status: 'error', error: { code: 'DATABASE_UNAVAILABLE', message: 'Down' } },
            503,
          ),
        ),
    })
    await userEvent.click(screen.getByRole('button', { name: /refresh/i }))

    const banner = await screen.findByRole('alert')

    expect(banner).toHaveTextContent(/previous successful load/)
    expect(banner).toHaveTextContent(/not be loaded/)
    // The stale table is still on screen, so the dashboard never blanks on a failed refresh.
    expect(screen.getByRole('table')).toBeInTheDocument()
  })
})
