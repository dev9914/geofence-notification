import { describe, expect, it } from 'vitest';
import { DEFAULT_GEOFENCE } from '../config/geofence.js';
import { EARTH_RADIUS_METERS, type Coordinates } from '../utils/distance.js';
import { ValidationError } from '../utils/errors.js';
import {
  DEFAULT_COOLDOWN_MS,
  createGeofenceService,
  type GeofenceReading,
  type GeofenceService,
} from './geofenceService.js';

const BASE_TIME = 1_700_000_000_000;

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

const OUTSIDE = pointNorthOf(CENTER, 200);
const ON_BOUNDARY = pointNorthOf(CENTER, DEFAULT_GEOFENCE.radiusMeters);
const JUST_OUTSIDE = pointNorthOf(CENTER, DEFAULT_GEOFENCE.radiusMeters + 0.001);

function createClock(start = BASE_TIME) {
  let current = start;

  return {
    now: () => current,
    advance: (milliseconds: number) => {
      current += milliseconds;
      return current;
    },
  };
}

function createService(overrides: Parameters<typeof createGeofenceService>[0] = {}): GeofenceService {
  return createGeofenceService(overrides);
}

function insideReading(overrides: Partial<GeofenceReading> = {}): GeofenceReading {
  return { ...CENTER, accuracy: 5, timestamp: BASE_TIME, ...overrides };
}

function outsideReading(overrides: Partial<GeofenceReading> = {}): GeofenceReading {
  return { ...OUTSIDE, accuracy: 5, timestamp: BASE_TIME, ...overrides };
}

function enterAndExit(service: GeofenceService): void {
  service.evaluate(insideReading());
  service.evaluate(outsideReading());
}

describe('createGeofenceService', () => {
  it('uses a 60 second cooldown by default', () => {
    expect(DEFAULT_COOLDOWN_MS).toBe(60_000);
  });

  it('triggers a notification on the initial entry', () => {
    const service = createService();

    const result = service.evaluate(insideReading());

    expect(result.status).toBe('inside');
    expect(result.previousState).toBe('outside');
    expect(result.nextState).toBe('inside');
    expect(result.notification).toEqual({ shouldNotify: true, reason: 'enter' });
    expect(result.distanceMeters).toBe(0);
    expect(service.getState()).toBe('inside');
  });

  it('suppresses duplicate notifications while continuously inside', () => {
    const service = createService();
    service.evaluate(insideReading());

    const second = service.evaluate(insideReading({ accuracy: 8 }));
    const third = service.evaluate(insideReading({ accuracy: 12 }));

    expect(second.notification).toEqual({ shouldNotify: false, reason: 'duplicate-inside' });
    expect(third.notification).toEqual({ shouldNotify: false, reason: 'duplicate-inside' });
    expect(second.nextState).toBe('inside');
  });

  it('confirms an exit without notifying and re-arms entry eligibility', () => {
    const clock = createClock();
    const service = createService({ now: clock.now });
    service.evaluate(insideReading());

    const exit = service.evaluate(outsideReading());

    expect(exit.status).toBe('outside');
    expect(exit.nextState).toBe('outside');
    expect(exit.notification).toEqual({ shouldNotify: false, reason: 'outside' });
    expect(exit.distanceMeters).toBeCloseTo(200, 6);
    expect(service.getState()).toBe('outside');

    clock.advance(DEFAULT_COOLDOWN_MS);

    const reentry = service.evaluate(insideReading());

    expect(reentry.previousState).toBe('outside');
    expect(reentry.notification).toEqual({ shouldNotify: true, reason: 'enter' });
  });

  it('suppresses a re-entry inside the cooldown window', () => {
    const clock = createClock();
    const service = createService({ now: clock.now });
    enterAndExit(service);
    clock.advance(DEFAULT_COOLDOWN_MS - 1);

    const reentry = service.evaluate(insideReading());

    expect(reentry.previousState).toBe('outside');
    expect(reentry.nextState).toBe('inside');
    expect(reentry.notification).toEqual({ shouldNotify: false, reason: 'cooldown-active' });
  });

  it('notifies again once the cooldown has fully elapsed', () => {
    const clock = createClock();
    const service = createService({ now: clock.now });
    enterAndExit(service);

    clock.advance(DEFAULT_COOLDOWN_MS - 1);
    expect(service.evaluate(insideReading()).notification.shouldNotify).toBe(false);

    clock.advance(1);
    const outside = service.evaluate(outsideReading());
    expect(outside.notification.shouldNotify).toBe(false);

    const reentry = service.evaluate(insideReading());

    expect(reentry.notification).toEqual({ shouldNotify: true, reason: 'enter' });
  });

  it('does not replay an entry that was swallowed by the cooldown', () => {
    const clock = createClock();
    const service = createService({ now: clock.now });
    enterAndExit(service);
    clock.advance(1_000);

    const suppressed = service.evaluate(insideReading());
    expect(suppressed.notification).toEqual({ shouldNotify: false, reason: 'cooldown-active' });

    // Still inside after the cooldown expires: this is a duplicate, not a new entry.
    clock.advance(DEFAULT_COOLDOWN_MS * 2);

    const stillInside = service.evaluate(insideReading());

    expect(stillInside.notification).toEqual({ shouldNotify: false, reason: 'duplicate-inside' });
  });

  it('honours a custom cooldown window', () => {
    const clock = createClock();
    const service = createService({ now: clock.now, cooldownMs: 10_000 });
    enterAndExit(service);

    clock.advance(9_999);
    expect(service.evaluate(insideReading()).notification).toEqual({
      shouldNotify: false,
      reason: 'cooldown-active',
    });

    service.evaluate(outsideReading());
    clock.advance(1);
    expect(service.evaluate(insideReading()).notification).toEqual({
      shouldNotify: true,
      reason: 'enter',
    });
  });

  it('classifies poor GPS accuracy as uncertain and never notifies', () => {
    const service = createService();

    const result = service.evaluate(insideReading({ accuracy: DEFAULT_GEOFENCE.radiusMeters + 1 }));

    expect(result.status).toBe('uncertain');
    expect(result.previousState).toBe('outside');
    expect(result.nextState).toBe('outside');
    expect(result.distanceMeters).toBeNull();
    expect(result.notification).toEqual({ shouldNotify: false, reason: 'uncertain-accuracy' });
    expect(service.getState()).toBe('outside');
  });

  it('treats accuracy exactly at the threshold as usable', () => {
    const service = createService();

    const result = service.evaluate(insideReading({ accuracy: DEFAULT_GEOFENCE.radiusMeters }));

    expect(result.status).toBe('inside');
    expect(result.notification).toEqual({ shouldNotify: true, reason: 'enter' });
  });

  it('preserves confirmed inside state across uncertain readings', () => {
    const clock = createClock();
    const service = createService({ now: clock.now, cooldownMs: 0 });
    service.evaluate(insideReading());

    const uncertain = service.evaluate(insideReading({ accuracy: 250 }));

    expect(uncertain.status).toBe('uncertain');
    expect(uncertain.nextState).toBe('inside');
    expect(service.getState()).toBe('inside');

    const stillInside = service.evaluate(insideReading());

    expect(stillInside.notification).toEqual({ shouldNotify: false, reason: 'duplicate-inside' });
  });

  it('does not let uncertain readings confirm an entry or consume entry eligibility', () => {
    const clock = createClock();
    const service = createService({ now: clock.now });

    const uncertainBeforeEntry = service.evaluate(insideReading({ accuracy: 100 }));
    const entry = service.evaluate(insideReading());

    expect(uncertainBeforeEntry.status).toBe('uncertain');
    expect(uncertainBeforeEntry.nextState).toBe('outside');
    expect(entry.previousState).toBe('outside');
    expect(entry.notification).toEqual({ shouldNotify: true, reason: 'enter' });
  });

  it('does not treat an uncertain reading as an exit', () => {
    const clock = createClock();
    const service = createService({ now: clock.now, cooldownMs: 0 });
    service.evaluate(insideReading());

    const uncertainOutside = service.evaluate(outsideReading({ accuracy: 80 }));

    expect(uncertainOutside.status).toBe('uncertain');
    expect(uncertainOutside.nextState).toBe('inside');
    expect(service.getState()).toBe('inside');
    expect(service.evaluate(insideReading()).notification).toEqual({
      shouldNotify: false,
      reason: 'duplicate-inside',
    });
  });

  it('treats a point exactly on the 30 metre boundary as inside', () => {
    const service = createService();

    const result = service.evaluate({ ...ON_BOUNDARY, accuracy: 1, timestamp: BASE_TIME });

    expect(result.distanceMeters).toBeCloseTo(DEFAULT_GEOFENCE.radiusMeters, 6);
    expect(result.status).toBe('inside');
    expect(result.notification).toEqual({ shouldNotify: true, reason: 'enter' });
  });

  it('treats a point just outside the boundary as outside', () => {
    const service = createService();

    const result = service.evaluate({ ...JUST_OUTSIDE, accuracy: 1, timestamp: BASE_TIME });

    expect(result.distanceMeters).toBeGreaterThan(DEFAULT_GEOFENCE.radiusMeters);
    expect(result.status).toBe('outside');
    expect(result.notification).toEqual({ shouldNotify: false, reason: 'outside' });
  });

  it('keeps state per instance so there is no shared mutable state', () => {
    const first = createService();
    const second = createService();

    expect(first.evaluate(insideReading()).notification.shouldNotify).toBe(true);
    expect(second.getState()).toBe('outside');
    expect(second.evaluate(insideReading()).notification.shouldNotify).toBe(true);
  });

  it('rejects invalid coordinates', () => {
    const service = createService();
    const cases: Array<Partial<GeofenceReading>> = [
      { latitude: 90.5 },
      { latitude: -90.5 },
      { longitude: 180.5 },
      { longitude: -180.5 },
      { latitude: Number.NaN },
      { longitude: Number.NEGATIVE_INFINITY },
      { latitude: '18.5' as unknown as number },
    ];

    for (const testCase of cases) {
      expect(() => service.evaluate(insideReading(testCase))).toThrow(ValidationError);
    }
  });

  it('rejects invalid accuracy values', () => {
    const service = createService();
    const cases: Array<Partial<GeofenceReading>> = [
      { accuracy: -1 },
      { accuracy: Number.NaN },
      { accuracy: Number.POSITIVE_INFINITY },
      { accuracy: '5' as unknown as number },
    ];

    for (const testCase of cases) {
      expect(() => service.evaluate(insideReading(testCase))).toThrow(ValidationError);
    }
  });

  it('rejects invalid timestamps', () => {
    const service = createService();
    const cases: Array<Partial<GeofenceReading>> = [
      { timestamp: -1 },
      { timestamp: 1.5 },
      { timestamp: Number.NaN },
      { timestamp: '1700000000000' as unknown as number },
    ];

    for (const testCase of cases) {
      expect(() => service.evaluate(insideReading(testCase))).toThrow(ValidationError);
    }
  });

  it('rejects invalid non-reading input and invalid options', () => {
    const service = createService();

    expect(() => service.evaluate(null as unknown as GeofenceReading)).toThrow(ValidationError);
    expect(() => createService({ cooldownMs: -1 })).toThrow(ValidationError);
    expect(() => createService({ accuracyThresholdMeters: Number.NaN })).toThrow(ValidationError);
    expect(() => createService({ geofence: { ...DEFAULT_GEOFENCE, latitude: 91 } })).toThrow(
      ValidationError,
    );
  });
});
