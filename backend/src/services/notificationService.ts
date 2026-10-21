import { listGeofences, type GeofenceDescriptor } from '../config/geofence.js';
import type {
  NewNotificationEventRecord,
  NotificationEventRecord,
} from '../models/NotificationEvent.js';
import {
  BOUNDARY_EPSILON_METERS,
  assertValidCoordinates,
  haversineMeters,
} from '../utils/distance.js';
import { HttpError, ValidationError } from '../utils/errors.js';
import { assertNonNegativeNumber } from '../utils/validation.js';
import {
  createMongooseNotificationRepository,
  isDuplicateKeyError,
  type NotificationRepository,
  type NotificationStats,
} from './notificationRepository.js';

/**
 * Notification event service.
 *
 * The API validates and persists notification events. It deliberately does *not* re-derive
 * the visitor's entry/exit history: entry detection, duplicate suppression and the 60 s
 * cooldown stay in the client state machine (`src/services/geofenceService.ts`), which is
 * the only component that sees the live GPS stream.
 */

/** A reading older than this is stale: GPS samples are expected to be near real time. */
export const MAX_READING_AGE_MS = 30_000;

/**
 * Tolerated clock skew for a reading whose timestamp is slightly ahead of the server.
 * Anything further in the future is treated as an invalid timestamp.
 */
export const MAX_FUTURE_SKEW_MS = 5_000;

/** Validated request payload accepted by the notification API. */
export interface NotificationEventInput {
  /** Client-generated UUID used as the idempotency key. */
  eventId: string;
  sessionId: string;
  geofenceId: string;
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  /** Epoch milliseconds of the client's observation. */
  occurredAt: number;
}

export interface RecordedNotification {
  event: NotificationEventRecord;
  /** `true` when this `eventId` had already been recorded. */
  duplicate: boolean;
  /** Distance recomputed by the server from the canonical geofence coordinates. */
  distanceMeters: number;
  /** Canonical geofence coordinates the distance was measured against. */
  targetLatitude: number;
  targetLongitude: number;
}

export interface NotificationPage {
  items: NotificationEventRecord[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface NotificationService {
  recordEvent(input: NotificationEventInput): Promise<RecordedNotification>;
  listEvents(options: { limit: number; offset: number }): Promise<NotificationPage>;
  getStats(): Promise<NotificationStats>;
}

export interface NotificationServiceOptions {
  /** Defaults to the Mongoose-backed repository. */
  repository?: NotificationRepository;
  /** Known geofences; defaults to the canonical configured set. */
  geofences?: readonly GeofenceDescriptor[];
  /** Injected clock for deterministic time validation. Defaults to `Date.now`. */
  now?: () => number;
}

/**
 * Rejects a reading that is stale or unreasonably in the future.
 *
 * Pure and clock-agnostic, so the time rules can be tested without waiting for real time
 * to pass.
 */
export function assertReadingTimestamp(occurredAt: number, now: number): number {
  const timestamp = assertNonNegativeNumber(occurredAt, 'occurredAt');

  if (!Number.isInteger(timestamp)) {
    throw new ValidationError('occurredAt must be an integer number of epoch milliseconds');
  }

  const age = assertNonNegativeNumber(now, 'current time') - timestamp;

  if (age > MAX_READING_AGE_MS) {
    throw new ValidationError(
      `occurredAt is stale: the reading is ${Math.round(age)} ms old, older than the ${MAX_READING_AGE_MS} ms maximum reading age`,
      'STALE_READING',
    );
  }

  if (age < -MAX_FUTURE_SKEW_MS) {
    throw new ValidationError(
      `occurredAt is in the future: the reading is ${Math.round(-age)} ms ahead of the server clock, beyond the tolerated ${MAX_FUTURE_SKEW_MS} ms clock skew`,
      'FUTURE_READING',
    );
  }

  return timestamp;
}

/** Resolves a geofence id, rejecting unknown and disabled geofences. */
export function assertGeofenceUsable(
  geofence: GeofenceDescriptor | undefined,
  geofenceId: string,
): GeofenceDescriptor {
  if (!geofence) {
    throw new HttpError(404, 'GEOFENCE_NOT_FOUND', `Unknown geofence '${geofenceId}'`);
  }

  if (!geofence.enabled) {
    throw new HttpError(409, 'GEOFENCE_DISABLED', `Geofence '${geofence.id}' is disabled`);
  }

  return geofence;
}

export function createNotificationService(
  options: NotificationServiceOptions = {},
): NotificationService {
  const repository = options.repository ?? createMongooseNotificationRepository();
  const geofences = options.geofences ?? listGeofences();
  const now = options.now ?? Date.now;

  function resolveGeofence(geofenceId: string): GeofenceDescriptor {
    return assertGeofenceUsable(
      geofences.find((geofence) => geofence.id === geofenceId),
      geofenceId,
    );
  }

  async function recordEvent(input: NotificationEventInput): Promise<RecordedNotification> {
    const geofence = resolveGeofence(input.geofenceId);
    assertReadingTimestamp(input.occurredAt, now());

    const accuracyMeters = assertNonNegativeNumber(input.accuracyMeters, 'accuracyMeters');
    const threshold = geofence.policy.accuracyThresholdMeters;

    if (accuracyMeters > threshold) {
      throw new ValidationError(
        `accuracyMeters is ${accuracyMeters} m, worse than the ${threshold} m accuracy policy of geofence '${geofence.id}'; the reading is too imprecise to record`,
        'ACCURACY_TOO_LOW',
      );
    }

    assertValidCoordinates(input);
    // Both sides of the measurement come from the server: the user position from the
    // request, the target from the canonical geofence configuration.
    const distanceMeters = haversineMeters(input, geofence);

    if (distanceMeters > geofence.radiusMeters + BOUNDARY_EPSILON_METERS) {
      throw new ValidationError(
        `the reading is ${distanceMeters.toFixed(2)} m from the geofence centre, outside the ${geofence.radiusMeters} m radius`,
        'OUTSIDE_GEOFENCE',
      );
    }

    const record: NewNotificationEventRecord = {
      eventId: input.eventId,
      geofenceId: geofence.id,
      sessionId: input.sessionId,
      occurredAt: new Date(input.occurredAt),
      userLatitude: input.latitude,
      userLongitude: input.longitude,
      targetLatitude: geofence.latitude,
      targetLongitude: geofence.longitude,
      distanceMeters,
      accuracyMeters,
    };

    try {
      const event = await repository.insert(record);

      return {
        event,
        duplicate: false,
        distanceMeters,
        targetLatitude: geofence.latitude,
        targetLongitude: geofence.longitude,
      };
    } catch (error) {
      // Two requests with the same `eventId` can pass validation concurrently; the unique
      // index rejects the loser, which is a successful idempotent outcome, not a failure.
      if (isDuplicateKeyError(error)) {
        const existing = await withDatabaseErrorHandling(
          `read the notification event '${input.eventId}' that already exists`,
          () => repository.findByEventId(input.eventId),
        );

        if (existing) {
          return {
            event: existing,
            duplicate: true,
            distanceMeters: existing.distanceMeters,
            targetLatitude: existing.targetLatitude,
            targetLongitude: existing.targetLongitude,
          };
        }

        throw new HttpError(
          409,
          'DUPLICATE_EVENT',
          'A notification event with this eventId is already recorded',
        );
      }

      throw toDatabaseError('store the notification event', error);
    }
  }

  async function listEvents({
    limit,
    offset,
  }: {
    limit: number;
    offset: number;
  }): Promise<NotificationPage> {
    const result = await withDatabaseErrorHandling('read the notification history', () =>
      repository.list({ limit, offset }),
    );

    return {
      items: result.items,
      total: result.total,
      limit,
      offset,
      hasMore: offset + result.items.length < result.total,
    };
  }

  async function getStats(): Promise<NotificationStats> {
    return withDatabaseErrorHandling('read the notification statistics', () =>
      repository.getStats(),
    );
  }

  return { recordEvent, listEvents, getStats };
}

/** Runs a repository call, translating anything unexpected into a sanitized 503. */
async function withDatabaseErrorHandling<T>(operation: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }

    throw toDatabaseError(operation, error);
  }
}

/**
 * Maps a persistence failure onto a consistent HTTP error.
 *
 * The raw driver error is logged server-side only: the client never sees database
 * internals, stack traces or driver messages.
 */
function toDatabaseError(operation: string, error: unknown): HttpError {
  console.error(`Failed to ${operation}`, error);

  return new HttpError(503, 'DATABASE_UNAVAILABLE', 'Notification storage is unavailable');
}
