import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_GEOFENCE,
  DEFAULT_GEOFENCE_DESCRIPTOR,
  type GeofenceDescriptor,
} from '../config/geofence.js';
import type { NewNotificationEventRecord } from '../models/NotificationEvent.js';
import {
  createInMemoryNotificationRepository,
  duplicateKeyError,
  type InMemoryNotificationRepository,
} from '../testing/inMemoryNotificationRepository.js';
import { EARTH_RADIUS_METERS, type Coordinates } from '../utils/distance.js';
import { HttpError } from '../utils/errors.js';
import {
  MAX_FUTURE_SKEW_MS,
  MAX_READING_AGE_MS,
  createNotificationService,
  type NotificationEventInput,
  type NotificationService,
} from './notificationService.js';

/** Fixed server clock: every time-dependent rule is deterministic, and nothing sleeps. */
const NOW = 1_700_000_000_000;

const CENTER: Coordinates = {
  latitude: DEFAULT_GEOFENCE.latitude,
  longitude: DEFAULT_GEOFENCE.longitude,
};

/** Point due north of `origin` at `meters`, using the same Earth radius as the implementation. */
function pointNorthOf(origin: Coordinates, meters: number): Coordinates {
  return {
    latitude: origin.latitude + (meters / EARTH_RADIUS_METERS) * (180 / Math.PI),
    longitude: origin.longitude,
  };
}

const TEN_METERS_NORTH = pointNorthOf(CENTER, 10);
const ON_BOUNDARY = pointNorthOf(CENTER, DEFAULT_GEOFENCE.radiusMeters);
const JUST_OUTSIDE = pointNorthOf(CENTER, DEFAULT_GEOFENCE.radiusMeters + 0.001);

const DISABLED_GEOFENCE: GeofenceDescriptor = {
  ...DEFAULT_GEOFENCE_DESCRIPTOR,
  id: 'disabled-geofence',
  enabled: false,
};

let repository: InMemoryNotificationRepository;
let service: NotificationService;

beforeEach(() => {
  // Database failures are logged server-side by design; keep the test output clean.
  vi.spyOn(console, 'error').mockImplementation(() => {});
  repository = createInMemoryNotificationRepository();
  service = createNotificationService({ repository, now: () => NOW });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function buildInput(overrides: Partial<NotificationEventInput> = {}): NotificationEventInput {
  return {
    eventId: randomUUID(),
    sessionId: 'session-1',
    geofenceId: DEFAULT_GEOFENCE.id,
    latitude: TEN_METERS_NORTH.latitude,
    longitude: TEN_METERS_NORTH.longitude,
    accuracyMeters: 5,
    occurredAt: NOW,
    ...overrides,
  };
}

/** Awaits a rejected promise and returns the error, failing if it resolved instead. */
async function captureError(promise: Promise<unknown>): Promise<HttpError> {
  try {
    await promise;
  } catch (error) {
    return error as HttpError;
  }

  throw new Error('Expected the operation to reject, but it resolved');
}

async function expectHttpError(
  promise: Promise<unknown>,
  statusCode: number,
  code: string,
): Promise<HttpError> {
  const error = await captureError(promise);

  expect(error).toBeInstanceOf(HttpError);
  expect(error.statusCode).toBe(statusCode);
  expect(error.code).toBe(code);

  return error;
}

describe('createNotificationService: recordEvent', () => {
  it('persists the event with a server-recalculated distance and the canonical target', async () => {
    const input = buildInput();

    const result = await service.recordEvent(input);

    expect(result.duplicate).toBe(false);
    expect(result.distanceMeters).toBeCloseTo(10, 6);
    expect(result.targetLatitude).toBe(DEFAULT_GEOFENCE.latitude);
    expect(result.targetLongitude).toBe(DEFAULT_GEOFENCE.longitude);

    expect(result.event.eventId).toBe(input.eventId);
    expect(result.event.sessionId).toBe(input.sessionId);
    expect(result.event.geofenceId).toBe(DEFAULT_GEOFENCE.id);
    expect(result.event.userLatitude).toBe(input.latitude);
    expect(result.event.userLongitude).toBe(input.longitude);
    expect(result.event.targetLatitude).toBe(DEFAULT_GEOFENCE.latitude);
    expect(result.event.targetLongitude).toBe(DEFAULT_GEOFENCE.longitude);
    expect(result.event.distanceMeters).toBe(result.distanceMeters);
    expect(result.event.accuracyMeters).toBe(5);
    expect(result.event.occurredAt.getTime()).toBe(NOW);

    expect(repository.count()).toBe(1);
    expect(repository.insertAttempts()).toBe(1);
  });

  it('stores the canonical target even when the reading is at the geofence centre', async () => {
    const result = await service.recordEvent(
      buildInput({ latitude: CENTER.latitude, longitude: CENTER.longitude }),
    );

    expect(result.distanceMeters).toBe(0);
    expect(result.event.targetLatitude).toBe(DEFAULT_GEOFENCE.latitude);
    expect(result.event.targetLongitude).toBe(DEFAULT_GEOFENCE.longitude);
  });

  it('accepts a reading exactly on the 30 metre boundary', async () => {
    const result = await service.recordEvent(
      buildInput({ latitude: ON_BOUNDARY.latitude, longitude: ON_BOUNDARY.longitude }),
    );

    expect(result.duplicate).toBe(false);
    expect(result.distanceMeters).toBeCloseTo(DEFAULT_GEOFENCE.radiusMeters, 6);
  });

  it('rejects a reading just outside the radius', async () => {
    const error = await expectHttpError(
      service.recordEvent(
        buildInput({ latitude: JUST_OUTSIDE.latitude, longitude: JUST_OUTSIDE.longitude }),
      ),
      400,
      'OUTSIDE_GEOFENCE',
    );

    expect(error.message).toContain('outside the 30 m radius');
    expect(repository.count()).toBe(0);
    expect(repository.insertAttempts()).toBe(0);
  });

  it('rejects a reading with accuracy worse than the 30 metre policy', async () => {
    await expectHttpError(service.recordEvent(buildInput({ accuracyMeters: 30.5 })), 400, 'ACCURACY_TOO_LOW');
    expect(repository.count()).toBe(0);
  });

  it('accepts a reading whose accuracy is exactly at the policy threshold', async () => {
    const result = await service.recordEvent(buildInput({ accuracyMeters: 30 }));

    expect(result.event.accuracyMeters).toBe(30);
  });

  it('rejects a negative accuracy', async () => {
    await expectHttpError(service.recordEvent(buildInput({ accuracyMeters: -1 })), 400, 'VALIDATION_ERROR');
  });

  it('rejects an invalid coordinate', async () => {
    await expectHttpError(
      service.recordEvent(buildInput({ latitude: 91 })),
      400,
      'VALIDATION_ERROR',
    );
    await expectHttpError(
      service.recordEvent(buildInput({ longitude: Number.NaN })),
      400,
      'VALIDATION_ERROR',
    );
  });

  it('rejects a stale reading older than the documented 30 second maximum age', async () => {
    const error = await expectHttpError(
      service.recordEvent(buildInput({ occurredAt: NOW - (MAX_READING_AGE_MS + 1) })),
      400,
      'STALE_READING',
    );

    expect(error.message).toContain('30000 ms maximum reading age');
  });

  it('accepts a reading exactly at the maximum age', async () => {
    const result = await service.recordEvent(buildInput({ occurredAt: NOW - MAX_READING_AGE_MS }));

    expect(result.duplicate).toBe(false);
  });

  it('rejects a timestamp unreasonably far in the future', async () => {
    const error = await expectHttpError(
      service.recordEvent(buildInput({ occurredAt: NOW + MAX_FUTURE_SKEW_MS + 1 })),
      400,
      'FUTURE_READING',
    );

    expect(error.message).toContain('ahead of the server clock');
  });

  it('accepts a timestamp within the tolerated clock skew', async () => {
    const result = await service.recordEvent(buildInput({ occurredAt: NOW + MAX_FUTURE_SKEW_MS }));

    expect(result.event.occurredAt.getTime()).toBe(NOW + MAX_FUTURE_SKEW_MS);
  });

  it('rejects a non-integer timestamp', async () => {
    await expectHttpError(
      service.recordEvent(buildInput({ occurredAt: NOW + 0.5 })),
      400,
      'VALIDATION_ERROR',
    );
  });

  it('rejects a negative timestamp', async () => {
    await expectHttpError(service.recordEvent(buildInput({ occurredAt: -1 })), 400, 'VALIDATION_ERROR');
  });

  it('rejects an unknown geofence id', async () => {
    const error = await expectHttpError(
      service.recordEvent(buildInput({ geofenceId: 'missing-geofence' })),
      404,
      'GEOFENCE_NOT_FOUND',
    );

    expect(error.message).toContain('missing-geofence');
    expect(repository.insertAttempts()).toBe(0);
  });

  it('rejects a disabled geofence id', async () => {
    const disabledService = createNotificationService({
      repository,
      geofences: [DISABLED_GEOFENCE],
      now: () => NOW,
    });

    await expectHttpError(
      disabledService.recordEvent(buildInput({ geofenceId: DISABLED_GEOFENCE.id })),
      409,
      'GEOFENCE_DISABLED',
    );
  });

  it('is idempotent for a repeated eventId and does not create a second record', async () => {
    const eventId = randomUUID();
    const first = await service.recordEvent(buildInput({ eventId }));

    const second = await service.recordEvent(
      buildInput({ eventId, sessionId: 'session-2', accuracyMeters: 12 }),
    );

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.event.eventId).toBe(eventId);
    // The originally recorded values win: a repeat cannot rewrite the stored event.
    expect(second.event.sessionId).toBe('session-1');
    expect(second.event.accuracyMeters).toBe(5);
    expect(second.distanceMeters).toBe(first.distanceMeters);
    expect(repository.count()).toBe(1);
    // Two attempts: the second lost the unique-index race, which is the idempotent path.
    expect(repository.insertAttempts()).toBe(2);
  });

  it('treats a duplicate-key race as an idempotent success', async () => {
    const eventId = randomUUID();
    const concurrentlyStored: NewNotificationEventRecord = {
      eventId,
      geofenceId: DEFAULT_GEOFENCE.id,
      sessionId: 'session-concurrent',
      occurredAt: new Date(NOW),
      userLatitude: CENTER.latitude,
      userLongitude: CENTER.longitude,
      targetLatitude: DEFAULT_GEOFENCE.latitude,
      targetLongitude: DEFAULT_GEOFENCE.longitude,
      distanceMeters: 12.5,
      accuracyMeters: 5,
    };

    repository.simulateDuplicateKeyRaceWith(concurrentlyStored);

    const result = await service.recordEvent(buildInput({ eventId }));

    expect(result.duplicate).toBe(true);
    expect(result.event.sessionId).toBe('session-concurrent');
    expect(result.distanceMeters).toBe(12.5);
    expect(repository.count()).toBe(1);
  });

  it('reports a 409 when a duplicate key is raised with no stored record to return', async () => {
    repository.failNextInsertWith(duplicateKeyError());

    await expectHttpError(
      service.recordEvent(buildInput()),
      409,
      'DUPLICATE_EVENT',
    );
  });

  it('returns a sanitized 503 when the database is unavailable', async () => {
    repository.failNextInsertWith(new Error('connection <monitor> to 127.0.0.1:27017 closed'));

    const error = await expectHttpError(
      service.recordEvent(buildInput()),
      503,
      'DATABASE_UNAVAILABLE',
    );

    expect(error.message).toBe('Notification storage is unavailable');
    expect(error.message).not.toContain('mongodb');
    expect(error.message).not.toContain('127.0.0.1');
  });
});

describe('createNotificationService: listEvents', () => {
  beforeEach(async () => {
    await service.recordEvent(buildInput({ occurredAt: NOW - 3_000 }));
    await service.recordEvent(buildInput({ occurredAt: NOW - 1_000 }));
    await service.recordEvent(buildInput({ occurredAt: NOW - 2_000 }));
  });

  it('returns events newest first with pagination metadata', async () => {
    const page = await service.listEvents({ limit: 20, offset: 0 });

    expect(page.total).toBe(3);
    expect(page.limit).toBe(20);
    expect(page.offset).toBe(0);
    expect(page.hasMore).toBe(false);
    expect(page.items.map((item) => item.occurredAt.getTime())).toEqual([
      NOW - 1_000,
      NOW - 2_000,
      NOW - 3_000,
    ]);
  });

  it('pages without loading the whole collection', async () => {
    const first = await service.listEvents({ limit: 2, offset: 0 });
    const second = await service.listEvents({ limit: 2, offset: 2 });

    expect(first.items).toHaveLength(2);
    expect(first.total).toBe(3);
    expect(first.hasMore).toBe(true);
    expect(second.items).toHaveLength(1);
    expect(second.hasMore).toBe(false);
    expect(second.items[0]?.occurredAt.getTime()).toBe(NOW - 3_000);
  });

  it('returns an empty page past the end of the history', async () => {
    const page = await service.listEvents({ limit: 10, offset: 99 });

    expect(page.items).toEqual([]);
    expect(page.total).toBe(3);
    expect(page.hasMore).toBe(false);
  });

  it('returns a sanitized 503 when the database is unavailable', async () => {
    repository.failNextListWith(new Error('topology was destroyed'));

    const error = await expectHttpError(service.listEvents({ limit: 20, offset: 0 }), 503, 'DATABASE_UNAVAILABLE');

    expect(error.message).toBe('Notification storage is unavailable');
  });
});

describe('createNotificationService: getStats', () => {
  it('reports zero events and a null latest timestamp on an empty collection', async () => {
    await expect(service.getStats()).resolves.toEqual({ total: 0, latestOccurredAt: null });
  });

  it('derives the total and the most recent timestamp from storage', async () => {
    await service.recordEvent(buildInput({ occurredAt: NOW - 3_000 }));
    await service.recordEvent(buildInput({ occurredAt: NOW - 500 }));

    const stats = await service.getStats();

    expect(stats.total).toBe(2);
    expect(stats.latestOccurredAt?.getTime()).toBe(NOW - 500);
  });

  it('returns a sanitized 503 when the database is unavailable', async () => {
    repository.failNextStatsWith(new Error('not authorized on admin'));

    await expectHttpError(service.getStats(), 503, 'DATABASE_UNAVAILABLE');
  });
});

describe('assertReadingTimestamp', () => {
  it('enforces the documented maximum reading age of 30 seconds', () => {
    expect(MAX_READING_AGE_MS).toBe(30_000);
    expect(MAX_FUTURE_SKEW_MS).toBe(5_000);
  });
});
