import mongoose from 'mongoose';
import type { Model } from 'mongoose';

/**
 * Mongoose is a CommonJS package with no ESM build, and Node's ESM/CJS named-export
 * detection does not expose `Schema`, `model` and `models` to `import { ... } from
 * 'mongoose'` at runtime (`node dist/server.js` fails, even though the test transform
 * accepts it). The default import is the interop-safe form.
 */
const { Schema, model, models } = mongoose;

/**
 * Persisted notification events.
 *
 * Only server-verified data is stored: the target coordinates come from the canonical
 * geofence configuration and `distanceMeters` is recomputed by the API, so a client can
 * never make a distance or a target coordinate authoritative.
 */
export const NOTIFICATION_EVENT_MODEL_NAME = 'NotificationEvent';
export const NOTIFICATION_EVENT_COLLECTION = 'notificationEvents';

export interface NotificationEventRecord {
  /** Client-generated UUID, used as the idempotency key. */
  eventId: string;
  geofenceId: string;
  sessionId: string;
  /** When the client observed the entry (UTC). */
  occurredAt: Date;
  /** When the API/database created the record (UTC), stamped by Mongoose `timestamps`. */
  createdAt: Date;
  userLatitude: number;
  userLongitude: number;
  targetLatitude: number;
  targetLongitude: number;
  /** Distance in metres between the user and the geofence centre, measured server-side. */
  distanceMeters: number;
  accuracyMeters: number;
}

/** Fields a writer supplies; `createdAt` is stamped by Mongoose `timestamps`. */
export type NewNotificationEventRecord = Omit<NotificationEventRecord, 'createdAt'>;

const notificationEventSchema = new Schema<NewNotificationEventRecord>(
  {
    eventId: {
      type: String,
      required: true,
      // Creates a unique index, so concurrent duplicates are rejected by the database
      // rather than by a read-then-write race in the API.
      unique: true,
      trim: true,
    },
    geofenceId: { type: String, required: true, trim: true, index: true },
    sessionId: { type: String, required: true, trim: true, index: true },
    occurredAt: { type: Date, required: true },
    userLatitude: { type: Number, required: true, min: -90, max: 90 },
    userLongitude: { type: Number, required: true, min: -180, max: 180 },
    targetLatitude: { type: Number, required: true, min: -90, max: 90 },
    targetLongitude: { type: Number, required: true, min: -180, max: 180 },
    distanceMeters: { type: Number, required: true, min: 0 },
    accuracyMeters: { type: Number, required: true, min: 0 },
  },
  {
    collection: NOTIFICATION_EVENT_COLLECTION,
    // Only the creation time is meaningful for an immutable event; no `updatedAt`.
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
  },
);

/** History is always read newest first, so the index follows the read order. */
notificationEventSchema.index({ occurredAt: -1, _id: -1 });

/**
 * Reuses an existing compiled model when present so re-importing the module (tests, hot
 * reload) cannot raise `OverwriteModelError`.
 *
 * Index creation relies on Mongoose `autoIndex`, which is fine for this assessment build;
 * a production deployment would create the unique `eventId` index through a migration.
 */
export const NotificationEventModel: Model<NewNotificationEventRecord> =
  (models[NOTIFICATION_EVENT_MODEL_NAME] as Model<NewNotificationEventRecord> | undefined) ??
  model<NewNotificationEventRecord>(NOTIFICATION_EVENT_MODEL_NAME, notificationEventSchema);
