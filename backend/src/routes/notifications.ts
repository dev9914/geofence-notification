import { Router } from 'express';
import { createNotificationController } from '../controllers/notificationController.js';
import type { NotificationService } from '../services/notificationService.js';

/**
 * Notification routes.
 *
 * - `GET /stats` is registered before `/` so the literal path can never be shadowed by a
 *   future parameterised route.
 */
export function createNotificationRouter(service: NotificationService): Router {
  const router = Router();
  const controller = createNotificationController(service);

  router.get('/stats', controller.getStats);
  router.get('/', controller.list);
  router.post('/', controller.create);

  return router;
}
