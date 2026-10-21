import type { CreateNotificationPayload } from '../api/types'
import type { GeofenceReading } from './machine'

export interface EntryPayloadInput {
  /** Client-generated idempotency key; reuse it when retrying the same entry. */
  eventId: string
  /** Opaque browser-session id. */
  sessionId: string
  geofenceId: string
  reading: GeofenceReading
}

/**
 * Builds the exact request body `POST /api/v1/notifications` accepts.
 *
 * The backend validates this with a strict object schema, so the payload must contain these
 * seven keys and nothing else: the visitor's coordinates, the reported accuracy and the
 * observation time. The backend recomputes the distance from its own canonical geofence
 * coordinates, so no distance, radius or target coordinates may be sent.
 */
export function buildEntryPayload(input: EntryPayloadInput): CreateNotificationPayload {
  return {
    eventId: input.eventId,
    sessionId: input.sessionId,
    geofenceId: input.geofenceId,
    latitude: input.reading.latitude,
    longitude: input.reading.longitude,
    accuracyMeters: input.reading.accuracyMeters,
    occurredAt: Math.round(input.reading.occurredAt),
  }
}
