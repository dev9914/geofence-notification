/**
 * Types for the backend API contracts.
 *
 * These mirror the JSON produced by the backend exactly (see
 * `backend/src/controllers/*` and `backend/src/config/geofence.ts`); they are not a second
 * source of truth, only a description of the wire format.
 */

/** Visitor policy published by the backend for a geofence. */
export interface GeofencePolicy {
  /** Minimum interval between two notifications for the same visitor, in milliseconds. */
  cooldownMs: number
  /** Readings with worse horizontal accuracy are uncertain and are rejected by the API. */
  accuracyThresholdMeters: number
}

/** A geofence as returned by `GET /api/v1/geofences`. */
export interface Geofence {
  id: string
  name: string
  latitude: number
  longitude: number
  radiusMeters: number
  enabled: boolean
  policy: GeofencePolicy
}

/** A persisted notification event as returned by the API. */
export interface NotificationEvent {
  eventId: string
  geofenceId: string
  sessionId: string
  /** ISO-8601 instant at which the visitor's device observed the entry. */
  occurredAt: string
  /** ISO-8601 instant at which the backend stored the record. */
  createdAt: string
  userLatitude: number
  userLongitude: number
  targetLatitude: number
  targetLongitude: number
  /** Distance recomputed by the backend from the canonical geofence coordinates. */
  distanceMeters: number
  accuracyMeters: number
}

/** Response body of `POST /api/v1/notifications`. */
export interface RecordedNotification {
  /** `true` when the event had already been recorded for this `eventId`. */
  duplicate: boolean
  event: NotificationEvent
}

/** Pagination metadata returned with the notification history. */
export interface Pagination {
  total: number
  count: number
  limit: number
  offset: number
  hasMore: boolean
}

/** Response body of `GET /api/v1/notifications`. */
export interface NotificationPage {
  notifications: NotificationEvent[]
  pagination: Pagination
}

/** Response body of `GET /api/v1/notifications/stats`. */
export interface NotificationStats {
  totalEvents: number
  latestNotificationAt: string | null
}

/** Request body accepted by `POST /api/v1/notifications`. */
export interface CreateNotificationPayload {
  /** Client-generated UUID, used by the backend as the idempotency key. */
  eventId: string
  sessionId: string
  geofenceId: string
  latitude: number
  longitude: number
  accuracyMeters: number
  /** Epoch milliseconds of the observation. */
  occurredAt: number
}

/** Error envelope returned by every failing endpoint. */
export interface ApiErrorEnvelope {
  status: 'error'
  error: {
    code: string
    message: string
  }
}
