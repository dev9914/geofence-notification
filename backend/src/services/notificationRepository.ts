import {
  NotificationEventModel,
  type NewNotificationEventRecord,
  type NotificationEventRecord,
} from '../models/NotificationEvent.js';

/**
 * Persistence adapter for notification events.
 *
 * Keeping the Mongoose calls behind this interface means the notification service can be
 * exercised in tests with an in-memory fake, without a live Atlas connection.
 */

/** Lean documents carry the Mongoose-stamped `createdAt`, which the schema type omits. */
type NotificationEventLean = NewNotificationEventRecord & { createdAt: Date };

export interface NotificationListOptions {
  limit: number;
  offset: number;
}

export interface NotificationListResult {
  /** One page of events, newest first. */
  items: NotificationEventRecord[];
  /** Total number of stored events, not just the returned page. */
  total: number;
}

export interface NotificationStats {
  /** Total number of recorded notification events. */
  total: number;
  /** Most recent `occurredAt`, or `null` when nothing has been recorded yet. */
  latestOccurredAt: Date | null;
}

export interface NotificationRepository {
  insert(record: NewNotificationEventRecord): Promise<NotificationEventRecord>;
  findByEventId(eventId: string): Promise<NotificationEventRecord | null>;
  list(options: NotificationListOptions): Promise<NotificationListResult>;
  getStats(): Promise<NotificationStats>;
}

/** MongoDB duplicate-key error code, raised by the unique `eventId` index. */
const DUPLICATE_KEY_CODE = 11000;

export function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === DUPLICATE_KEY_CODE
  );
}

/** Newest first, with `_id` as a tie-breaker so pagination is stable. */
const NEWEST_FIRST = { occurredAt: -1, _id: -1 } as const;

function toRecord(document: NotificationEventLean): NotificationEventRecord {
  return {
    eventId: document.eventId,
    geofenceId: document.geofenceId,
    sessionId: document.sessionId,
    occurredAt: document.occurredAt,
    createdAt: document.createdAt,
    userLatitude: document.userLatitude,
    userLongitude: document.userLongitude,
    targetLatitude: document.targetLatitude,
    targetLongitude: document.targetLongitude,
    distanceMeters: document.distanceMeters,
    accuracyMeters: document.accuracyMeters,
  };
}

export function createMongooseNotificationRepository(): NotificationRepository {
  return {
    async insert(record) {
      const created = await NotificationEventModel.create(record);

      return toRecord(created.toObject<NotificationEventLean>());
    },

    async findByEventId(eventId) {
      const document = await NotificationEventModel.findOne({ eventId })
        .lean<NotificationEventLean | null>()
        .exec();

      return document ? toRecord(document) : null;
    },

    async list({ limit, offset }) {
      // The pagination window is applied by the database; the collection is never loaded
      // into memory in full.
      const [documents, total] = await Promise.all([
        NotificationEventModel.find({})
          .sort(NEWEST_FIRST)
          .skip(offset)
          .limit(limit)
          .lean<NotificationEventLean[]>()
          .exec(),
        NotificationEventModel.countDocuments({}).exec(),
      ]);

      return { items: documents.map(toRecord), total };
    },

    async getStats() {
      const [total, latest] = await Promise.all([
        NotificationEventModel.countDocuments({}).exec(),
        NotificationEventModel.findOne({})
          .sort(NEWEST_FIRST)
          .select({ occurredAt: 1 })
          .lean<{ occurredAt: Date } | null>()
          .exec(),
      ]);

      return { total, latestOccurredAt: latest?.occurredAt ?? null };
    },
  };
}
