import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useNotificationRecorder } from './useNotificationRecorder'
import { demoEventId, demoGeofence, jsonResponse, recordedBody, recordedEvent } from '../test/fixtures'
import type { CreateNotificationPayload } from '../api/types'

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const payload: CreateNotificationPayload = {
  eventId: demoEventId,
  sessionId: 'session-1',
  geofenceId: demoGeofence.id,
  latitude: 18.56791,
  longitude: 73.91933,
  accuracyMeters: 5,
  occurredAt: 1_700_000_000_000,
}

/** Bodies of every POST the mock received. */
function postedBodies(): CreateNotificationPayload[] {
  return fetchMock.mock.calls
    .filter(([, init]) => init?.method === 'POST')
    .map(([, init]) => JSON.parse(String(init?.body)) as CreateNotificationPayload)
}

describe('useNotificationRecorder', () => {
  it('reports pending until the backend has accepted the event', async () => {
    fetchMock.mockResolvedValue(jsonResponse(recordedBody()))

    const { result } = renderHook(() => useNotificationRecorder())

    act(() => {
      result.current.record(payload)
    })

    expect(result.current.status).toBe('pending')

    await waitFor(() => {
      expect(result.current.status).toBe('recorded')
    })

    expect(result.current.entry).toEqual({
      eventId: demoEventId,
      duplicate: false,
      occurredAt: recordedEvent.occurredAt,
      createdAt: recordedEvent.createdAt,
      distanceMeters: recordedEvent.distanceMeters,
    })
    expect(result.current.failure).toBeNull()
    expect(postedBodies()).toEqual([payload])
  })

  it('ignores a repeated submission of an event the backend already accepted', async () => {
    fetchMock.mockResolvedValue(jsonResponse(recordedBody()))

    const { result } = renderHook(() => useNotificationRecorder())

    act(() => {
      result.current.record(payload)
    })
    await waitFor(() => {
      expect(result.current.status).toBe('recorded')
    })

    act(() => {
      result.current.record(payload)
    })

    expect(postedBodies()).toHaveLength(1)
    expect(result.current.entry?.eventId).toBe(demoEventId)
  })

  it('submits only one request while another is in flight', () => {
    fetchMock.mockReturnValue(new Promise<Response>(() => {}))

    const { result } = renderHook(() => useNotificationRecorder())

    act(() => {
      result.current.record(payload)
      result.current.record(payload)
      result.current.record({ ...payload, eventId: '22222222-3333-4444-8555-666666666666' })
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.current.status).toBe('pending')
  })

  it('reports a duplicate response without claiming a second record', async () => {
    fetchMock.mockResolvedValue(jsonResponse(recordedBody(recordedEvent, true)))

    const { result } = renderHook(() => useNotificationRecorder())

    act(() => {
      result.current.record(payload)
    })

    await waitFor(() => {
      expect(result.current.status).toBe('recorded')
    })

    expect(result.current.entry?.duplicate).toBe(true)
  })

  it('reports a failed persistence instead of a success', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ status: 'error', error: { code: 'DATABASE_UNAVAILABLE', message: 'Down' } }, 503),
    )

    const { result } = renderHook(() => useNotificationRecorder())

    act(() => {
      result.current.record(payload)
    })

    await waitFor(() => {
      expect(result.current.status).toBe('failed')
    })

    expect(result.current.entry).toBeNull()
    expect(result.current.failure?.code).toBe('DATABASE_UNAVAILABLE')
    expect(result.current.failure?.message).toMatch(/not saved/)
    expect(result.current.canRetry).toBe(true)
  })

  it('reports an unreachable API as a failure the visitor can retry', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    const { result } = renderHook(() => useNotificationRecorder())

    act(() => {
      result.current.record(payload)
    })

    await waitFor(() => {
      expect(result.current.status).toBe('failed')
    })

    expect(result.current.failure?.code).toBe('NETWORK_ERROR')
    expect(result.current.canRetry).toBe(true)
  })

  it('retries the same event id so the backend stays idempotent', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ status: 'error', error: { code: 'DATABASE_UNAVAILABLE', message: 'Down' } }, 503),
    )

    const { result } = renderHook(() => useNotificationRecorder())

    act(() => {
      result.current.record(payload)
    })
    await waitFor(() => {
      expect(result.current.status).toBe('failed')
    })

    fetchMock.mockResolvedValue(jsonResponse(recordedBody()))

    act(() => {
      result.current.retry()
    })

    await waitFor(() => {
      expect(result.current.status).toBe('recorded')
    })

    const bodies = postedBodies()

    expect(bodies).toHaveLength(2)
    expect(bodies[1]).toEqual(bodies[0])
    expect(bodies[1].eventId).toBe(demoEventId)
  })

  it('clears the panel when dismissed', async () => {
    fetchMock.mockResolvedValue(jsonResponse(recordedBody()))

    const { result } = renderHook(() => useNotificationRecorder())

    act(() => {
      result.current.record(payload)
    })
    await waitFor(() => {
      expect(result.current.status).toBe('recorded')
    })

    act(() => {
      result.current.dismiss()
    })

    expect(result.current.status).toBe('idle')
    expect(result.current.entry).toBeNull()
    expect(result.current.failure).toBeNull()
    expect(result.current.canRetry).toBe(false)
  })
})
