import { Router } from 'express';
import type { NotificationService } from '../services/notificationService.js';
import { createGeofenceRouter } from './geofences.js';
import { createNotificationRouter } from './notifications.js';

/**
 * Versioned API surface, mounted at `/api/v1`.
 *
 * | Method | Path                          | Purpose                                  |
 * | ------ | ----------------------------- | ---------------------------------------- |
 * | GET    | `/api/v1/geofences`           | Canonical demo geofence and its policy    |
 * | POST   | `/api/v1/notifications`       | Validate and persist a notification event |
 * | GET    | `/api/v1/notifications`       | Persisted history, newest first, paged    |
 * | GET    | `/api/v1/notifications/stats` | Database-derived summary statistics       |
 *
 * SECURITY NOTE (assessment demo build): none of these endpoints is authenticated. They
 * expose a location and the notification history, so this build is demo-only: production
 * use requires authenticated and authorised admin access in front of them. The `sessionId`
 * and `eventId` fields are identifiers supplied by the client, not credentials.
 */
export function createApiRouter(notificationService: NotificationService): Router {
  const router = Router();

  router.use('/geofences', createGeofenceRouter());
  router.use('/notifications', createNotificationRouter(notificationService));

  return router;
}
