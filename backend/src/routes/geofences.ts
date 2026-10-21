import { Router } from 'express';
import { createGeofenceController } from '../controllers/geofenceController.js';

/** `GET /geofences` - the canonical demo geofence and its policy. */
export function createGeofenceRouter(): Router {
  const router = Router();
  const controller = createGeofenceController();

  router.get('/', controller.list);

  return router;
}
