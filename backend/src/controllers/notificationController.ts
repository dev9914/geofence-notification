import type { NextFunction, Request, Response } from 'express';
import type { NotificationEventRecord } from '../models/NotificationEvent.js';
import {
  createNotificationBodySchema,
  listNotificationsQuerySchema,
} from '../schemas/notification.js';
import { parseWithSchema } from '../schemas/parse.js';
import type { NotificationService } from '../services/notificationService.js';

/**
 * Notification endpoints.
 *
 * Thin controllers: validation lives in `schemas/`, business rules and persistence in
 * `services/notificationService.ts`. Every thrown error is handed to the centralized
 * error middleware, which produces the shared JSON error envelope.
 *
 * SECURITY NOTE (assessment demo build): these endpoints are public and expose location
 * data and notification history. No authentication or authorisation has been implemented;
 * production use requires authenticated, authorised admin access.
 */
export function serializeNotificationEvent(event: NotificationEventRecord) {
  return {
    eventId: event.eventId,
    geofenceId: event.geofenceId,
    sessionId: event.sessionId,
    occurredAt: event.occurredAt.toISOString(),
    createdAt: event.createdAt.toISOString(),
    userLatitude: event.userLatitude,
    userLongitude: event.userLongitude,
    targetLatitude: event.targetLatitude,
    targetLongitude: event.targetLongitude,
    distanceMeters: event.distanceMeters,
    accuracyMeters: event.accuracyMeters,
  };
}

export function createNotificationController(service: NotificationService) {
  return {
    async create(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const input = parseWithSchema(createNotificationBodySchema, req.body);
        const result = await service.recordEvent(input);

        // 201 for a newly stored event, 200 for an idempotent repeat: the event was
        // already recorded and nothing new was created.
        res.status(result.duplicate ? 200 : 201).json({
          status: 'ok',
          message: result.duplicate
            ? 'Notification event was already recorded'
            : 'Notification event recorded',
          data: {
            duplicate: result.duplicate,
            event: serializeNotificationEvent(result.event),
          },
        });
      } catch (error) {
        next(error);
      }
    },

    async list(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const query = parseWithSchema(listNotificationsQuerySchema, req.query, 'query parameters');
        const page = await service.listEvents(query);

        res.status(200).json({
          status: 'ok',
          data: {
            notifications: page.items.map(serializeNotificationEvent),
            pagination: {
              total: page.total,
              count: page.items.length,
              limit: page.limit,
              offset: page.offset,
              hasMore: page.hasMore,
            },
          },
        });
      } catch (error) {
        next(error);
      }
    },

    async getStats(_req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const stats = await service.getStats();

        res.status(200).json({
          status: 'ok',
          data: {
            totalEvents: stats.total,
            latestNotificationAt: stats.latestOccurredAt
              ? stats.latestOccurredAt.toISOString()
              : null,
          },
        });
      } catch (error) {
        next(error);
      }
    },
  };
}
