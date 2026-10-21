import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ValidationError } from '../utils/errors.js';
import { parseWithSchema } from './parse.js';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  createNotificationBodySchema,
  listNotificationsQuerySchema,
} from './notification.js';

const EVENT_ID = '3f1e0b7a-1c2d-4e5f-8a9b-0c1d2e3f4a5b';
const OCCURRED_AT_ISO_WITH_OFFSET = '2026-10-21T10:00:00+05:30';
const OCCURRED_AT_EPOCH_MS = Date.parse(OCCURRED_AT_ISO_WITH_OFFSET);

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    eventId: EVENT_ID,
    sessionId: 'session-1',
    geofenceId: 'demo-geofence',
    latitude: 18.56788997616755,
    longitude: 73.91932741340476,
    accuracyMeters: 5,
    occurredAt: OCCURRED_AT_EPOCH_MS,
    ...overrides,
  };
}

/**
 * Joins the issues of a failed parse into one `path: message` string.
 *
 * Zod reports unrecognised keys with an empty path, so the messages (not just the paths)
 * have to be inspected for the strict-object cases below.
 */
function bodyIssues(overrides: Record<string, unknown>): string {
  const result = createNotificationBodySchema.safeParse(validBody(overrides));

  return result.success
    ? ''
    : result.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ');
}

describe('createNotificationBodySchema', () => {
  it('accepts a valid payload with an epoch-millisecond occurredAt', () => {
    const parsed = createNotificationBodySchema.parse(validBody());

    expect(parsed.eventId).toBe(EVENT_ID);
    expect(parsed.occurredAt).toBe(OCCURRED_AT_EPOCH_MS);
  });

  it('normalises an ISO-8601 occurredAt with a UTC offset to epoch milliseconds', () => {
    const parsed = createNotificationBodySchema.parse(
      validBody({ occurredAt: OCCURRED_AT_ISO_WITH_OFFSET }),
    );

    expect(parsed.occurredAt).toBe(OCCURRED_AT_EPOCH_MS);
  });

  it('accepts a UUID that is not the shared fixture', () => {
    const eventId = randomUUID();

    expect(createNotificationBodySchema.parse(validBody({ eventId })).eventId).toBe(eventId);
  });

  it('rejects a malformed eventId', () => {
    expect(bodyIssues({ eventId: 'nope' })).toContain('eventId');
    expect(bodyIssues({ eventId: '' })).toContain('eventId');
  });

  it('rejects a missing eventId', () => {
    const payload = validBody();
    delete payload.eventId;

    expect(createNotificationBodySchema.safeParse(payload).success).toBe(false);
  });

  it('rejects empty identifiers', () => {
    expect(bodyIssues({ sessionId: '' })).toContain('sessionId');
    expect(bodyIssues({ geofenceId: '' })).toContain('geofenceId');
  });

  it('rejects out-of-range latitude and longitude', () => {
    expect(bodyIssues({ latitude: 90.1 })).toContain('latitude');
    expect(bodyIssues({ latitude: -90.1 })).toContain('latitude');
    expect(bodyIssues({ longitude: 180.1 })).toContain('longitude');
    expect(bodyIssues({ longitude: -180.1 })).toContain('longitude');
  });

  it('accepts the exact coordinate bounds', () => {
    const parsed = createNotificationBodySchema.parse(
      validBody({ latitude: 90, longitude: -180 }),
    );

    expect(parsed.latitude).toBe(90);
    expect(parsed.longitude).toBe(-180);
  });

  it('rejects non-finite coordinates instead of coercing them', () => {
    expect(bodyIssues({ latitude: Number.NaN })).toContain('latitude');
    expect(bodyIssues({ latitude: Number.POSITIVE_INFINITY })).toContain('latitude');
    expect(bodyIssues({ longitude: Number.NEGATIVE_INFINITY })).toContain('longitude');
  });

  it('rejects coordinate strings instead of coercing them', () => {
    expect(bodyIssues({ latitude: '18.5678' })).toContain('latitude');
    expect(bodyIssues({ latitude: null })).toContain('latitude');
  });

  it('rejects a negative or non-finite accuracyMeters', () => {
    expect(bodyIssues({ accuracyMeters: -1 })).toContain('accuracyMeters');
    expect(bodyIssues({ accuracyMeters: Number.NaN })).toContain('accuracyMeters');
    expect(bodyIssues({ accuracyMeters: '5' })).toContain('accuracyMeters');
  });

  it('accepts a zero accuracyMeters value at the schema level', () => {
    expect(createNotificationBodySchema.parse(validBody({ accuracyMeters: 0 })).accuracyMeters).toBe(
      0,
    );
  });

  it('rejects invalid occurredAt values', () => {
    expect(bodyIssues({ occurredAt: 'not-a-date' })).toContain('occurredAt');
    expect(bodyIssues({ occurredAt: 1.5 })).toContain('occurredAt');
    expect(bodyIssues({ occurredAt: null })).toContain('occurredAt');
    expect(bodyIssues({ occurredAt: {} })).toContain('occurredAt');
  });

  it('leaves a negative timestamp to the service, which owns the recency rules', () => {
    // The schema only checks the shape; whether the instant is recent enough (including
    // the rejection of a negative epoch) belongs to the service, which owns the clock.
    expect(createNotificationBodySchema.parse(validBody({ occurredAt: -1 })).occurredAt).toBe(-1);
  });

  it('rejects a local ISO timestamp without a UTC offset', () => {
    expect(bodyIssues({ occurredAt: '2026-10-21T10:00:00' })).toContain('occurredAt');
  });

  it('rejects client-supplied distance, radius and target coordinates as unknown keys', () => {
    // `strictObject` is the point here: an authoritative-looking extra field must fail the
    // request rather than be silently ignored.
    expect(bodyIssues({ distanceMeters: 1 })).toContain('distanceMeters');
    expect(bodyIssues({ radiusMeters: 1000 })).toContain('radiusMeters');
    expect(bodyIssues({ targetLatitude: 0 })).toContain('targetLatitude');
    expect(bodyIssues({ targetLongitude: 0 })).toContain('targetLongitude');
  });

  it('rejects an unknown key', () => {
    expect(createNotificationBodySchema.safeParse(validBody({ b: 1 })).success).toBe(false);
  });

  it('rejects a payload that is not an object', () => {
    expect(createNotificationBodySchema.safeParse(undefined).success).toBe(false);
    expect(createNotificationBodySchema.safeParse('{}').success).toBe(false);
  });
});

describe('listNotificationsQuerySchema', () => {
  it('applies the documented defaults when the query is empty', () => {
    expect(listNotificationsQuerySchema.parse({})).toEqual({
      limit: DEFAULT_PAGE_SIZE,
      offset: 0,
    });
    expect(DEFAULT_PAGE_SIZE).toBe(20);
    expect(MAX_PAGE_SIZE).toBe(100);
  });

  it('coerces numeric strings, because query parameters always arrive as strings', () => {
    expect(listNotificationsQuerySchema.parse({ limit: '5', offset: '10' })).toEqual({
      limit: 5,
      offset: 10,
    });
  });

  it('accepts the documented bounds', () => {
    expect(listNotificationsQuerySchema.parse({ limit: 1 })).toEqual({ limit: 1, offset: 0 });
    expect(listNotificationsQuerySchema.parse({ limit: String(MAX_PAGE_SIZE) })).toEqual({
      limit: MAX_PAGE_SIZE,
      offset: 0,
    });
    expect(listNotificationsQuerySchema.parse({ offset: '0' })).toEqual({
      limit: DEFAULT_PAGE_SIZE,
      offset: 0,
    });
  });

  it('rejects out-of-bounds and malformed pagination', () => {
    expect(listNotificationsQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(listNotificationsQuerySchema.safeParse({ limit: '1000' }).success).toBe(false);
    expect(listNotificationsQuerySchema.safeParse({ limit: 'abc' }).success).toBe(false);
    expect(listNotificationsQuerySchema.safeParse({ limit: '1.5' }).success).toBe(false);
    expect(listNotificationsQuerySchema.safeParse({ offset: '-1' }).success).toBe(false);
    expect(listNotificationsQuerySchema.safeParse({ offset: 'x' }).success).toBe(false);
  });

  it('ignores unknown query parameters', () => {
    expect(listNotificationsQuerySchema.parse({ limit: '2', sort: 'asc' })).toEqual({
      limit: 2,
      offset: 0,
    });
  });
});

describe('parseWithSchema', () => {
  it('returns the parsed value on success', () => {
    expect(parseWithSchema(createNotificationBodySchema, validBody()).eventId).toBe(EVENT_ID);
  });

  it('throws a 400 validation error that names the failing fields', () => {
    let captured: unknown;

    try {
      parseWithSchema(createNotificationBodySchema, validBody({ eventId: 'nope' }));
    } catch (error) {
      captured = error;
    }

    expect(captured).toBeInstanceOf(ValidationError);
    const error = captured as ValidationError;
    expect(error.statusCode).toBe(400);
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.message).toContain('Invalid request body');
    expect(error.message).toContain('eventId');
  });

  it('names the subject of the failed parse', () => {
    let captured: unknown;

    try {
      parseWithSchema(listNotificationsQuerySchema, { limit: '0' }, 'query parameters');
    } catch (error) {
      captured = error;
    }

    expect((captured as ValidationError).message).toContain('Invalid query parameters');
  });

  it('never echoes the received value back in the message', () => {
    const offending = 'raw-client-value-9f8e7d';

    let captured: unknown;

    try {
      parseWithSchema(createNotificationBodySchema, validBody({ eventId: offending }));
    } catch (error) {
      captured = error;
    }

    expect(captured).toBeInstanceOf(ValidationError);
    expect((captured as ValidationError).message).not.toContain(offending);
  });
});
