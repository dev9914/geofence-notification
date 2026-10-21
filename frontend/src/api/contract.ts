import { ApiError } from './client'
import type {
  ApiErrorEnvelope,
  Geofence,
  NotificationEvent,
  NotificationPage,
  NotificationStats,
  Pagination,
  RecordedNotification,
} from './types'

/**
 * Runtime validation of API responses.
 *
 * The backend contract is known, but an unreachable API, a proxy or a misconfigured base URL
 * can all answer with something else (HTML, an empty body, a different shape). Parsing
 * here keeps `any` out of the application and turns contract drift into a clear, typed error
 * instead of `undefined` leaking into the UI.
 */

const CONTRACT_ERROR_CODE = 'INVALID_RESPONSE'

function contractError(path: string, expected: string): ApiError {
  return new ApiError(
    `The geofence API returned an unexpected response (${path} should be ${expected}).`,
    CONTRACT_ERROR_CODE,
    null,
  )
}

function readRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw contractError(path, 'an object')
  }

  return value as Record<string, unknown>
}

function readArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw contractError(path, 'an array')
  }

  return value
}

function readString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw contractError(path, 'a non-empty string')
  }

  return value
}

function readNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw contractError(path, 'a finite number')
  }

  return value
}

function readBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') {
    throw contractError(path, 'a boolean')
  }

  return value
}

function readNullableString(value: unknown, path: string): string | null {
  if (value === null) {
    return null
  }

  return readString(value, path)
}

function readData(body: unknown): Record<string, unknown> {
  return readRecord(readRecord(body, 'body').data, 'data')
}

function parseGeofence(value: unknown, path: string): Geofence {
  const record = readRecord(value, path)
  const policy = readRecord(record.policy, `${path}.policy`)

  return {
    id: readString(record.id, `${path}.id`),
    name: readString(record.name, `${path}.name`),
    latitude: readNumber(record.latitude, `${path}.latitude`),
    longitude: readNumber(record.longitude, `${path}.longitude`),
    radiusMeters: readNumber(record.radiusMeters, `${path}.radiusMeters`),
    enabled: readBoolean(record.enabled, `${path}.enabled`),
    policy: {
      cooldownMs: readNumber(policy.cooldownMs, `${path}.policy.cooldownMs`),
      accuracyThresholdMeters: readNumber(
        policy.accuracyThresholdMeters,
        `${path}.policy.accuracyThresholdMeters`,
      ),
    },
  }
}

function parseNotificationEvent(value: unknown, path: string): NotificationEvent {
  const record = readRecord(value, path)

  return {
    eventId: readString(record.eventId, `${path}.eventId`),
    geofenceId: readString(record.geofenceId, `${path}.geofenceId`),
    sessionId: readString(record.sessionId, `${path}.sessionId`),
    occurredAt: readString(record.occurredAt, `${path}.occurredAt`),
    createdAt: readString(record.createdAt, `${path}.createdAt`),
    userLatitude: readNumber(record.userLatitude, `${path}.userLatitude`),
    userLongitude: readNumber(record.userLongitude, `${path}.userLongitude`),
    targetLatitude: readNumber(record.targetLatitude, `${path}.targetLatitude`),
    targetLongitude: readNumber(record.targetLongitude, `${path}.targetLongitude`),
    distanceMeters: readNumber(record.distanceMeters, `${path}.distanceMeters`),
    accuracyMeters: readNumber(record.accuracyMeters, `${path}.accuracyMeters`),
  }
}

function parsePagination(value: unknown, path: string): Pagination {
  const record = readRecord(value, path)

  return {
    total: readNumber(record.total, `${path}.total`),
    count: readNumber(record.count, `${path}.count`),
    limit: readNumber(record.limit, `${path}.limit`),
    offset: readNumber(record.offset, `${path}.offset`),
    hasMore: readBoolean(record.hasMore, `${path}.hasMore`),
  }
}

/** Parses `GET /api/v1/geofences`. */
export function parseGeofenceList(body: unknown): Geofence[] {
  const data = readData(body)

  return readArray(data.geofences, 'data.geofences').map((item, index) =>
    parseGeofence(item, `data.geofences[${index}]`),
  )
}

/** Parses `POST /api/v1/notifications`. */
export function parseRecordedNotification(body: unknown): RecordedNotification {
  const data = readData(body)

  return {
    duplicate: readBoolean(data.duplicate, 'data.duplicate'),
    event: parseNotificationEvent(data.event, 'data.event'),
  }
}

/** Parses `GET /api/v1/notifications`. */
export function parseNotificationPage(body: unknown): NotificationPage {
  const data = readData(body)

  return {
    notifications: readArray(data.notifications, 'data.notifications').map((item, index) =>
      parseNotificationEvent(item, `data.notifications[${index}]`),
    ),
    pagination: parsePagination(data.pagination, 'data.pagination'),
  }
}

/** Parses `GET /api/v1/notifications/stats`. */
export function parseNotificationStats(body: unknown): NotificationStats {
  const data = readData(body)

  return {
    totalEvents: readNumber(data.totalEvents, 'data.totalEvents'),
    latestNotificationAt: readNullableString(
      data.latestNotificationAt,
      'data.latestNotificationAt',
    ),
  }
}

/** True when a parsed body is the backend's error envelope. */
export function isApiErrorEnvelope(body: unknown): body is ApiErrorEnvelope {
  if (typeof body !== 'object' || body === null) {
    return false
  }

  const error = (body as { error?: unknown }).error

  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { code?: unknown }).code === 'string' &&
    typeof (error as { message?: unknown }).message === 'string'
  )
}
