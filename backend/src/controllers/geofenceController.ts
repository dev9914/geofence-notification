import type { Request, Response } from 'express';
import { listGeofences } from '../config/geofence.js';

/**
 * Geofence endpoints.
 *
 * The assessment ships a single fixed demo geofence, so there is deliberately no
 * create/update/delete API: `config/geofence.ts` stays the only source of truth.
 *
 * SECURITY NOTE (assessment demo build): this endpoint is public and reveals the demo
 * location. It is not protected by any authentication, and it must not be deployed that
 * way: a production deployment requires authenticated and authorised admin access.
 */
export function createGeofenceController() {
  return {
    list(_req: Request, res: Response): void {
      res.status(200).json({
        status: 'ok',
        data: {
          geofences: listGeofences().map((geofence) => ({
            id: geofence.id,
            name: geofence.name,
            latitude: geofence.latitude,
            longitude: geofence.longitude,
            radiusMeters: geofence.radiusMeters,
            enabled: geofence.enabled,
            policy: {
              cooldownMs: geofence.policy.cooldownMs,
              accuracyThresholdMeters: geofence.policy.accuracyThresholdMeters,
            },
          })),
        },
      });
    },
  };
}
