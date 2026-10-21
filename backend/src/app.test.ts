import { randomUUID } from 'node:crypto';
import type { Application } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import { DEFAULT_GEOFENCE, DEFAULT_GEOFENCE_POLICY } from './config/geofence.js';
import { createNotificationService } from './services/notificationService.js';
import {
  createInMemoryNotificationRepository,
  type InMemoryNotificationRepository,
} from './testing/inMemoryNotificationRepository.js';
import { EARTH_RADIUS_METERS, type Coordinates } from './utils/distance.js';

/**
 * HTTP contract tests.
 *
 * The app is built with `createApp`, which never connects to Atlas and never opens a
 * listener on its own; `supertest` binds an ephemeral port per request. Storage is the
 * in-memory repository, so no real database is touched.
 */

const NOW = 1_700_000_000_000;
const NOTIFICATIONS = '/api/v1/notifications';
const GEOFENCES = '/api/v1/geofences';

const CENTER: Coordinates = {
  latitude: DEFAULT_GEOFENCE.latitude,
  longitude: DEFAULT_GEOFENCE.longitude,
};

function pointNorthOf(origin: Coordinates, meters: number): Coordinates {
  return {
    latitude: origin.latitude + (meters / EARTH_RADIUS_METERS) * (180 / Math.PI),
    longitude: origin.longitude,
  };
}

const INSIDE = pointNorthOf(CENTER, 10);
const OUTSIDE = pointNorthOf(CENTER, 200);

let repository: InMemoryNotificationRepository;
let app: Application;

beforeEach(() => {
  // Storage failures are logged server-side on purpose; keep the test output readable.
  vi.spyOn(console, 'error').mockImplementation(() => {});
  repository = createInMemoryNotificationRepository();
  app = createApp({
    notificationService: createNotificationService({ repository, now: () => NOW }),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    eventId: randomUUID(),
    sessionId: 'session-1',
    geofenceId: DEFAULT_GEOFENCE.id,
    latitude: INSIDE.latitude,
    longitude: INSIDE.longitude,
    accuracyMeters: 5,
    occurredAt: NOW,
    ...overrides,
  };
}

function postNotification(body: Record<string, unknown>) {
  return request(app).post(NOTIFICATIONS).set('Content-Type', 'application/json').send(body);
}

describe('GET /health', () => {
  it('preserves the existing successful response', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'ok',
      message: 'Geofence API is running',
    });
  });
});

describe('GET /ready', () => {
  it('reports 503 while the database is not connected', async () => {
    const response = await request(app).get('/ready');

    expect(response.status).toBe(503);
    expect(response.body.status).toBe('error');
    expect(response.body.error.code).toBe('DATABASE_UNAVAILABLE');
  });
});

describe('GET /api/v1/geofences', () => {
  it('returns the canonical demo geofence and its policy', async () => {
    const response = await request(app).get(GEOFENCES);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.data.geofences).toEqual([
      {
        id: 'demo-geofence',
        name: 'Demo Geofence',
        latitude: 18.56788997616755,
        longitude: 73.91932741340476,
        radiusMeters: 30,
        enabled: true,
        policy: {
          cooldownMs: DEFAULT_GEOFENCE_POLICY.cooldownMs,
          accuracyThresholdMeters: DEFAULT_GEOFENCE_POLICY.accuracyThresholdMeters,
        },
      },
    ]);
    expect(DEFAULT_GEOFENCE_POLICY.cooldownMs).toBe(60_000);
    expect(DEFAULT_GEOFENCE_POLICY.accuracyThresholdMeters).toBe(30);
  });
});

describe('POST /api/v1/notifications', () => {
  it('records a valid event and returns the server-calculated distance', async () => {
    const body = validBody();

    const response = await postNotification(body);

    expect(response.status).toBe(201);
    expect(response.body.status).toBe('ok');
    expect(response.body.message).toBe('Notification event recorded');
    expect(response.body.data.duplicate).toBe(false);

    const { event } = response.body.data;
    expect(event.eventId).toBe(body.eventId);
    expect(event.sessionId).toBe('session-1');
    expect(event.geofenceId).toBe(DEFAULT_GEOFENCE.id);
    expect(event.distanceMeters).toBeCloseTo(10, 3);
    expect(event.targetLatitude).toBe(DEFAULT_GEOFENCE.latitude);
    expect(event.targetLongitude).toBe(DEFAULT_GEOFENCE.longitude);
    expect(event.userLatitude).toBe(body.latitude);
    expect(event.occurredAt).toBe(new Date(NOW).toISOString());
    expect(typeof event.createdAt).toBe('string');
    expect(repository.count()).toBe(1);
  });

  it('is idempotent for a repeated eventId', async () => {
    const body = validBody();

    const first = await postNotification(body);
    const second = await postNotification({ ...body, accuracyMeters: 12 });

    expect(first.status).toBe(201);
    expect(first.body.data.duplicate).toBe(false);

    expect(second.status).toBe(200);
    expect(second.body.status).toBe('ok');
    expect(second.body.message).toBe('Notification event was already recorded');
    expect(second.body.data.duplicate).toBe(true);
    expect(second.body.data.event.eventId).toBe(body.eventId);
    expect(second.body.data.event.accuracyMeters).toBe(5);
    expect(repository.count()).toBe(1);
  });

  it('rejects a malformed body with the shared validation envelope', async () => {
    const response = await postNotification(validBody({ eventId: 'not-a-uuid' }));

    expect(response.status).toBe(400);
    expect(response.body.status).toBe('error');
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.message).toContain('eventId');
    expect(repository.insertAttempts()).toBe(0);
  });

  it('rejects client-supplied authoritative fields', async () => {
    const response = await postNotification(validBody({ distanceMeters: 1 }));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a reading outside the radius', async () => {
    const response = await postNotification(
      validBody({ latitude: OUTSIDE.latitude, longitude: OUTSIDE.longitude }),
    );

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('OUTSIDE_GEOFENCE');
  });

  it('rejects a reading with poor accuracy', async () => {
    const response = await postNotification(validBody({ accuracyMeters: 31 }));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('ACCURACY_TOO_LOW');
  });

  it('rejects a stale reading', async () => {
    const response = await postNotification(validBody({ occurredAt: NOW - 31_000 }));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('STALE_READING');
  });

  it('rejects a reading from the far future', async () => {
    const response = await postNotification(validBody({ occurredAt: NOW + 30_000 }));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('FUTURE_READING');
  });

  it('accepts an ISO-8601 occurredAt', async () => {
    const response = await postNotification(
      validBody({ occurredAt: new Date(NOW - 1_000).toISOString() }),
    );

    expect(response.status).toBe(201);
    expect(response.body.data.event.occurredAt).toBe(new Date(NOW - 1_000).toISOString());
  });

  it('rejects an unknown geofence id with 404', async () => {
    const response = await postNotification(validBody({ geofenceId: 'nope' }));

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('GEOFENCE_NOT_FOUND');
  });

  it('rejects malformed JSON with the shared invalid-json envelope', async () => {
    const response = await request(app)
      .post(NOTIFICATIONS)
      .set('Content-Type', 'application/json')
      .send('{"eventId":');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      status: 'error',
      error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON' },
    });
  });

  it('returns a sanitized 503 when the database is unavailable', async () => {
    repository.failNextInsertWith(new Error('topology was destroyed'));

    const response = await postNotification(validBody());

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      status: 'error',
      error: {
        code: 'DATABASE_UNAVAILABLE',
        message: 'Notification storage is unavailable',
      },
    });
  });
});

describe('GET /api/v1/notifications', () => {
  beforeEach(async () => {
    await postNotification(validBody({ occurredAt: NOW - 3_000 }));
    await postNotification(validBody({ occurredAt: NOW - 1_000 }));
    await postNotification(validBody({ occurredAt: NOW - 2_000 }));
  });

  it('returns the history newest first with pagination metadata', async () => {
    const response = await request(app).get(NOTIFICATIONS);

    expect(response.status).toBe(200);
    expect(response.body.data.notifications).toHaveLength(3);
    expect(
      response.body.data.notifications.map((item: { occurredAt: string }) => item.occurredAt),
    ).toEqual([
      new Date(NOW - 1_000).toISOString(),
      new Date(NOW - 2_000).toISOString(),
      new Date(NOW - 3_000).toISOString(),
    ]);
    expect(response.body.data.pagination).toEqual({
      total: 3,
      count: 3,
      limit: 20,
      offset: 0,
      hasMore: false,
    });
  });

  it('honours limit and offset bounds', async () => {
    const response = await request(app).get(`${NOTIFICATIONS}?limit=2&offset=2`);

    expect(response.status).toBe(200);
    expect(response.body.data.notifications).toHaveLength(1);
    expect(response.body.data.pagination).toEqual({
      total: 3,
      count: 1,
      limit: 2,
      offset: 2,
      hasMore: false,
    });
  });

  it('rejects out-of-bounds pagination parameters', async () => {
    const tooLarge = await request(app).get(`${NOTIFICATIONS}?limit=1000`);
    const zero = await request(app).get(`${NOTIFICATIONS}?limit=0`);
    const negative = await request(app).get(`${NOTIFICATIONS}?offset=-1`);
    const text = await request(app).get(`${NOTIFICATIONS}?limit=abc`);

    for (const response of [tooLarge, zero, negative, text]) {
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('returns a sanitized 503 when the database is unavailable', async () => {
    repository.failNextListWith(new Error('connection reset'));

    const response = await request(app).get(NOTIFICATIONS);

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('DATABASE_UNAVAILABLE');
  });
});

describe('GET /api/v1/notifications/stats', () => {
  it('reports zero events on an empty collection', async () => {
    const response = await request(app).get(`${NOTIFICATIONS}/stats`);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ totalEvents: 0, latestNotificationAt: null });
  });

  it('reports the database-derived total and the most recent timestamp', async () => {
    await postNotification(validBody({ occurredAt: NOW - 3_000 }));
    await postNotification(validBody({ occurredAt: NOW - 500 }));

    const response = await request(app).get(`${NOTIFICATIONS}/stats`);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      totalEvents: 2,
      latestNotificationAt: new Date(NOW - 500).toISOString(),
    });
  });

  it('returns a sanitized 503 when the database is unavailable', async () => {
    repository.failNextStatsWith(new Error('not authorized'));

    const response = await request(app).get(`${NOTIFICATIONS}/stats`);

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('DATABASE_UNAVAILABLE');
  });
});

describe('unmatched routes', () => {
  it('returns the shared JSON 404 envelope', async () => {
    const response = await request(app).get('/api/v1/unknown');

    expect(response.status).toBe(404);
    expect(response.body.status).toBe('error');
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(response.body.error.message).toContain('GET /api/v1/unknown');
  });
});
