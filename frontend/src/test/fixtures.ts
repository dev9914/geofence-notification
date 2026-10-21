import type { Geofence, NotificationEvent, Pagination } from '../api/types'

/**
 * Test fixtures describing the shapes the backend actually returns.
 *
 * These are test doubles, not a second source of truth: production code always reads the
 * geofence from `GET /api/v1/geofences`. The values mirror the API response documented in
 * `backend/src/config/geofence.ts` and `backend/src/controllers/`.
 */

/** Same values the backend serves for the demo geofence. */
export const demoGeofence: Geofence = {
  id: 'demo-geofence',
  name: 'Demo Geofence',
  latitude: 18.56788997616755,
  longitude: 73.91932741340476,
  radiusMeters: 30,
  enabled: true,
  policy: {
    cooldownMs: 60_000,
    accuracyThresholdMeters: 30,
  },
}

export const demoEventId = '11111111-2222-4333-8444-555555555555'

export const demoSessionId = 'session-6f2b1c'

export const recordedEvent: NotificationEvent = {
  eventId: demoEventId,
  geofenceId: demoGeofence.id,
  sessionId: demoSessionId,
  occurredAt: '2026-10-21T14:30:00.000Z',
  createdAt: '2026-10-21T14:30:00.420Z',
  userLatitude: 18.56791,
  userLongitude: 73.91933,
  targetLatitude: demoGeofence.latitude,
  targetLongitude: demoGeofence.longitude,
  distanceMeters: 4.2,
  accuracyMeters: 5,
}

/** Body of `GET /api/v1/geofences`. */
export function geofenceListBody(geofences: Geofence[] = [demoGeofence]): unknown {
  return {
    status: 'ok',
    message: 'Geofences retrieved',
    data: { geofences },
  }
}

/** Body of `POST /api/v1/notifications`. */
export function recordedBody(event: NotificationEvent = recordedEvent, duplicate = false): unknown {
  return {
    status: 'ok',
    message: duplicate ? 'Notification already recorded' : 'Notification recorded',
    data: { duplicate, event },
  }
}

/** Body of `GET /api/v1/notifications`. */
export function notificationHistoryBody(
  notifications: NotificationEvent[] = [recordedEvent],
  pagination: Partial<Pagination> = {},
): unknown {
  return {
    status: 'ok',
    data: {
      notifications,
      pagination: {
        total: notifications.length,
        count: notifications.length,
        limit: 20,
        offset: 0,
        hasMore: false,
        ...pagination,
      },
    },
  }
}

/** Body of `GET /api/v1/notifications/stats`. `latestNotificationAt` is null when empty. */
export function statsBody(
  totalEvents = 1,
  latestNotificationAt: string | null = recordedEvent.occurredAt,
): unknown {
  return {
    status: 'ok',
    data: { totalEvents, latestNotificationAt },
  }
}

/** Minimal `Response` stand-in for a JSON body. */
export function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response
}

/** Minimal `Response` stand-in with a non-JSON (or empty) body. */
export function textResponse(text: string, status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(text),
  } as unknown as Response
}
