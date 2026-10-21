import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from './client'
import { fetchGeofences } from './geofences'
import { createNotificationEvent } from './notifications'
import {
  demoEventId,
  demoGeofence,
  geofenceListBody,
  jsonResponse,
  recordedBody,
  recordedEvent,
  textResponse,
} from '../test/fixtures'
import type { CreateNotificationPayload } from './types'

const API_ORIGIN = 'http://localhost:3000'

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** Runs a request that must fail and returns the typed `ApiError`. */
async function expectApiError(request: Promise<unknown>): Promise<ApiError> {
  try {
    await request
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError)
    return error as ApiError
  }

  throw new Error('Expected the request to reject, but it resolved')
}

const payload: CreateNotificationPayload = {
  eventId: demoEventId,
  sessionId: 'session-1',
  geofenceId: demoGeofence.id,
  latitude: 18.56791,
  longitude: 73.91933,
  accuracyMeters: 5,
  occurredAt: 1_700_000_000_000,
}

describe('apiRequest through fetchGeofences', () => {
  it('calls the canonical geofence endpoint and parses the envelope', async () => {
    fetchMock.mockResolvedValue(jsonResponse(geofenceListBody()))

    const geofences = await fetchGeofences()

    expect(geofences).toEqual([demoGeofence])
    expect(fetchMock.mock.calls[0][0]).toBe(`${API_ORIGIN}/api/v1/geofences`)
    expect(fetchMock.mock.calls[0][1]?.method).toBe('GET')
  })

  it('surfaces the backend error code and status', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { status: 'error', error: { code: 'DATABASE_UNAVAILABLE', message: 'Database unavailable' } },
        503,
      ),
    )

    const error = await expectApiError(fetchGeofences())

    expect(error.code).toBe('DATABASE_UNAVAILABLE')
    expect(error.status).toBe(503)
    expect(error.message).toBe('Database unavailable')
  })

  it('falls back to a generic code when the body is not the error envelope', async () => {
    fetchMock.mockResolvedValue(textResponse('<html>Bad gateway</html>', 502))

    const error = await expectApiError(fetchGeofences())

    expect(error.code).toBe('UNEXPECTED_STATUS')
    expect(error.status).toBe(502)
  })

  it('reports an unreachable API as a network error', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    const error = await expectApiError(fetchGeofences())

    expect(error.code).toBe('NETWORK_ERROR')
    expect(error.status).toBeNull()
    expect(error.message).toContain(API_ORIGIN)
  })

  it('reports an aborted request as a timeout', async () => {
    const abortError = new Error('The operation was aborted.')
    abortError.name = 'AbortError'
    fetchMock.mockRejectedValue(abortError)

    const error = await expectApiError(fetchGeofences())

    expect(error.code).toBe('REQUEST_TIMEOUT')
  })

  it('rejects a response that does not match the documented contract', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: 'ok', data: {} }))

    const error = await expectApiError(fetchGeofences())

    expect(error.code).toBe('INVALID_RESPONSE')
    expect(error.message).toContain('data.geofences')
  })
})

describe('createNotificationEvent', () => {
  it('sends the seven contract keys as JSON with the POST method', async () => {
    fetchMock.mockResolvedValue(jsonResponse(recordedBody()))

    const result = await createNotificationEvent(payload)
    const [url, init] = fetchMock.mock.calls[0]

    expect(url).toBe(`${API_ORIGIN}/api/v1/notifications`)
    expect(init?.method).toBe('POST')
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(String(init?.body))).toEqual(payload)
    expect(result.duplicate).toBe(false)
    expect(result.event.eventId).toBe(demoEventId)
    expect(result.event.distanceMeters).toBe(recordedEvent.distanceMeters)
  })

  it('reports an idempotent replay as a duplicate', async () => {
    fetchMock.mockResolvedValue(jsonResponse(recordedBody(recordedEvent, true)))

    const result = await createNotificationEvent(payload)

    expect(result.duplicate).toBe(true)
    expect(result.event.eventId).toBe(demoEventId)
  })

  it('surfaces a rejected persistence attempt as an ApiError', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { status: 'error', error: { code: 'STALE_READING', message: 'Reading too old' } },
        422,
      ),
    )

    const error = await expectApiError(createNotificationEvent(payload))

    expect(error.code).toBe('STALE_READING')
    expect(error.status).toBe(422)
  })
})
