import type {
  NewNotificationEventRecord,
  NotificationEventRecord,
} from '../models/NotificationEvent.js';
import type {
  NotificationListResult,
  NotificationRepository,
  NotificationStats,
} from '../services/notificationRepository.js';

/**
 * In-memory notification repository for the automated tests.
 *
 * It mirrors the behaviour the API depends on - the unique `eventId` constraint,
 * newest-first ordering, paging and the ability to fail - so tests can exercise the real
 * service, controllers and routes without a live MongoDB Atlas connection.
 *
 * This directory is excluded from the production build (`tsconfig.build.json`), so no test
 * helper is ever emitted into `dist/`.
 */
export interface InMemoryNotificationRepository extends NotificationRepository {
  /** Number of stored events; never a paged view. */
  count(): number;
  /** Number of `insert` calls, so duplicate suppression can be asserted. */
  insertAttempts(): number;
  events(): NotificationEventRecord[];
  /** Makes the next `insert` fail with a non-duplicate error (database unavailable). */
  failNextInsertWith(error: unknown): void;
  /** Makes the next `list` fail with a non-duplicate error. */
  failNextListWith(error: unknown): void;
  /** Makes the next `getStats` fail with a non-duplicate error. */
  failNextStatsWith(error: unknown): void;
  /**
   * Simulates a concurrent request that inserted `record` microseconds before this one:
   * the event is already stored and the next `insert` loses the unique-index race.
   */
  simulateDuplicateKeyRaceWith(record: NewNotificationEventRecord): void;
}

/** The shape MongoDB raises for a unique-index violation. */
export function duplicateKeyError(): { name: string; code: number } {
  return { name: 'MongoServerError', code: 11000 };
}

export function createInMemoryNotificationRepository(): InMemoryNotificationRepository {
  const events: NotificationEventRecord[] = [];
  let attempts = 0;
  let pendingInsertError: { error: unknown } | null = null;
  let pendingListError: { error: unknown } | null = null;
  let pendingStatsError: { error: unknown } | null = null;
  let loseNextInsertRace = false;

  /** Newest first, with insertion order as the tie-breaker. */
  function newestFirst(): NotificationEventRecord[] {
    return [...events].sort((left, right) => {
      const byTime = right.occurredAt.getTime() - left.occurredAt.getTime();
      return byTime !== 0 ? byTime : events.indexOf(right) - events.indexOf(left);
    });
  }

  return {
    async insert(record) {
      attempts += 1;

      if (pendingInsertError) {
        const { error } = pendingInsertError;
        pendingInsertError = null;
        throw error;
      }

      if (loseNextInsertRace || events.some((event) => event.eventId === record.eventId)) {
        loseNextInsertRace = false;
        throw duplicateKeyError();
      }

      // Mongoose would stamp `createdAt` from the server clock; any date works here.
      const stored: NotificationEventRecord = { ...record, createdAt: record.occurredAt };
      events.push(stored);

      return stored;
    },

    async findByEventId(eventId) {
      return events.find((event) => event.eventId === eventId) ?? null;
    },

    async list({ limit, offset }): Promise<NotificationListResult> {
      if (pendingListError) {
        const { error } = pendingListError;
        pendingListError = null;
        throw error;
      }

      return { items: newestFirst().slice(offset, offset + limit), total: events.length };
    },

    async getStats(): Promise<NotificationStats> {
      if (pendingStatsError) {
        const { error } = pendingStatsError;
        pendingStatsError = null;
        throw error;
      }

      const [latest] = newestFirst();

      return { total: events.length, latestOccurredAt: latest ? latest.occurredAt : null };
    },

    count: () => events.length,
    insertAttempts: () => attempts,
    events: () => [...events],

    failNextInsertWith(error) {
      pendingInsertError = { error };
    },
    failNextListWith(error) {
      pendingListError = { error };
    },
    failNextStatsWith(error) {
      pendingStatsError = { error };
    },
    simulateDuplicateKeyRaceWith(record) {
      events.push({ ...record, createdAt: record.occurredAt });
      loseNextInsertRace = true;
    },
  };
}
