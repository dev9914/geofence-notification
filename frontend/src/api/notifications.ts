import { apiRequest } from './client'
import { parseNotificationPage, parseNotificationStats, parseRecordedNotification } from './contract'
import type {
  CreateNotificationPayload,
  NotificationPage,
  NotificationStats,
  RecordedNotification,
} from './types'

/**
 * `POST /api/v1/notifications`
 *
 * The backend recomputes the distance from its own geofence coordinates, validates the
 * reading and treats a repeated `eventId` as an idempotent replay, so retrying a failed
 * submission with the same payload is safe.
 */
export function createNotificationEvent(
  payload: CreateNotificationPayload,
  options: { signal?: AbortSignal } = {},
): Promise<RecordedNotification> {
  return apiRequest('/api/v1/notifications', parseRecordedNotification, {
    method: 'POST',
    body: payload,
    signal: options.signal,
  })
}

/**
 * `GET /api/v1/notifications`
 *
 * Paginated history, newest first. Used by the admin dashboard in the next task.
 */
export function fetchNotificationHistory(
  options: { limit?: number; offset?: number; signal?: AbortSignal } = {},
): Promise<NotificationPage> {
  const params = new URLSearchParams()

  if (options.limit !== undefined) {
    params.set('limit', String(options.limit))
  }

  if (options.offset !== undefined) {
    params.set('offset', String(options.offset))
  }

  const query = params.toString()

  return apiRequest(`/api/v1/notifications${query.length > 0 ? `?${query}` : ''}`, parseNotificationPage, {
    signal: options.signal,
  })
}

/** `GET /api/v1/notifications/stats` — database-derived summary. Used by the dashboard. */
export function fetchNotificationStats(
  options: { signal?: AbortSignal } = {},
): Promise<NotificationStats> {
  return apiRequest('/api/v1/notifications/stats', parseNotificationStats, {
    signal: options.signal,
  })
}
