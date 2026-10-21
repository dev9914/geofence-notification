import { useCallback, useRef, useState } from 'react'
import { createNotificationEvent } from '../api/notifications'
import { describeApiFailure, type FailureDescription } from '../api/failures'
import type { CreateNotificationPayload } from '../api/types'

/**
 * Records geofence entry events through `POST /api/v1/notifications`.
 *
 * Behaviour the visitor interface depends on:
 * - Nothing is ever reported as recorded until the backend has answered, so the UI cannot
 *   claim a persistence that did not happen.
 * - Only one request is in flight at a time, and an `eventId` that the backend already
 *   accepted is never submitted again, so a location update cannot produce duplicate events.
 * - A failed submission keeps its payload, so Retry replays the *same* `eventId`; the
 *   backend's idempotency key then guarantees at most one stored event.
 */

export type RecordingStatus = 'idle' | 'pending' | 'recorded' | 'failed'

/** The event the backend acknowledged. */
export interface RecordedEntry {
  eventId: string
  /** `true` when the backend already had this event and replayed it. */
  duplicate: boolean
  occurredAt: string
  createdAt: string
  distanceMeters: number
}

export interface NotificationRecording {
  status: RecordingStatus
  entry: RecordedEntry | null
  failure: FailureDescription | null
  /** True when a failed submission can be retried with the same event id. */
  canRetry: boolean
  /** Submits an entry. Ignored while another request is in flight. */
  record: (payload: CreateNotificationPayload) => void
  /** Re-submits the last failed entry with its original event id. */
  retry: () => void
  /** Clears the panel. */
  dismiss: () => void
}

export function useNotificationRecorder(): NotificationRecording {
  const [status, setStatus] = useState<RecordingStatus>('idle')
  const [entry, setEntry] = useState<RecordedEntry | null>(null)
  const [failure, setFailure] = useState<FailureDescription | null>(null)
  const [canRetry, setCanRetry] = useState(false)

  const inFlightRef = useRef(false)
  const lastPayloadRef = useRef<CreateNotificationPayload | null>(null)
  const acceptedEventIdsRef = useRef<Set<string>>(new Set())

  const record = useCallback((payload: CreateNotificationPayload) => {
    if (inFlightRef.current) {
      return
    }

    if (acceptedEventIdsRef.current.has(payload.eventId)) {
      return
    }

    inFlightRef.current = true
    lastPayloadRef.current = payload
    setEntry(null)
    setFailure(null)
    setCanRetry(false)
    setStatus('pending')

    createNotificationEvent(payload)
      .then((result) => {
        acceptedEventIdsRef.current.add(result.event.eventId)

        setEntry({
          eventId: result.event.eventId,
          duplicate: result.duplicate,
          occurredAt: result.event.occurredAt,
          createdAt: result.event.createdAt,
          distanceMeters: result.event.distanceMeters,
        })
        setFailure(null)
        setCanRetry(false)
        setStatus('recorded')
      })
      .catch((error: unknown) => {
        setEntry(null)
        setFailure(describeApiFailure(error))
        setCanRetry(true)
        setStatus('failed')
      })
      .finally(() => {
        inFlightRef.current = false
      })
  }, [])

  const retry = useCallback(() => {
    const payload = lastPayloadRef.current

    if (payload === null || inFlightRef.current) {
      return
    }

    record(payload)
  }, [record])

  const dismiss = useCallback(() => {
    lastPayloadRef.current = null
    setEntry(null)
    setFailure(null)
    setCanRetry(false)
    setStatus('idle')
  }, [])

  return {
    status,
    entry,
    failure,
    canRetry,
    record,
    retry,
    dismiss,
  }
}
