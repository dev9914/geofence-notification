import { DEFAULT_COOLDOWN_MS, DEFAULT_GEOFENCE, type GeofenceConfig } from '../config/geofence.js';
import {
  BOUNDARY_EPSILON_METERS,
  assertValidCoordinates,
  haversineMeters,
  type Coordinates,
} from '../utils/distance.js';
import { ValidationError } from '../utils/errors.js';
import { assertFiniteNumber, assertNonNegativeNumber } from '../utils/validation.js';

/**
 * Geofence evaluation state machine.
 *
 * One instance tracks one device/session; all state lives in the closure created by
 * `createGeofenceService`, so there is no global mutable state.
 *
 * States:
 * - `outside` - default state before any confirmed entry, and after a confirmed exit.
 * - `inside` - the last trustworthy reading placed the device inside the radius.
 * - `uncertain` - the reading cannot be trusted (GPS accuracy worse than the threshold).
 *   It is a per-reading classification only: it never mutates the machine, so it can
 *   neither confirm an entry, nor count as an exit, nor consume entry eligibility.
 *
 * Notification rules:
 * - A notification fires only on a confirmed entry: a trustworthy reading inside the
 *   radius while the machine is not already inside.
 * - While the machine stays inside, further inside readings are duplicates and are
 *   suppressed.
 * - A confirmed exit (an `outside` reading) re-arms entry eligibility for the next entry.
 *
 * Cooldown (default 60 s, configurable per service):
 * - After a notification is emitted, the next notification is suppressed for `cooldownMs`.
 * - An entry swallowed by the cooldown still moves the machine to `inside`, and it is
 *   *not* replayed while the device keeps standing inside. A new notification requires a
 *   confirmed exit, a fresh entry, and the cooldown to have elapsed.
 * - Cooldown time comes from the injected clock (`now`, default `Date.now`) rather than
 *   from the device-supplied reading timestamp, so a skewed or replayed device clock
 *   cannot bypass the cooldown.
 *
 * `DEFAULT_COOLDOWN_MS` lives in `config/geofence.ts` (the client state machine and the
 * HTTP API must describe the same policy) and is re-exported here for this service's
 * existing callers and tests.
 */
export { DEFAULT_COOLDOWN_MS };

export type GeofenceState = 'inside' | 'outside' | 'uncertain';

export type NotificationReason =
  | 'enter'
  | 'duplicate-inside'
  | 'cooldown-active'
  | 'outside'
  | 'uncertain-accuracy';

export interface GeofenceReading extends Coordinates {
  /** Horizontal accuracy in metres, as reported by the Geolocation API. */
  accuracy: number;
  /** Sample time in epoch milliseconds, as reported by the device. */
  timestamp: number;
}

export interface NotificationDecision {
  shouldNotify: boolean;
  reason: NotificationReason;
}

export interface GeofenceEvaluation {
  /** Classification of this reading. */
  status: GeofenceState;
  /** Machine state before this reading was evaluated. */
  previousState: GeofenceState;
  /** Machine state after this reading; equals `previousState` for uncertain readings. */
  nextState: GeofenceState;
  /** Distance from the geofence centre in metres, or `null` when the reading is uncertain. */
  distanceMeters: number | null;
  notification: NotificationDecision;
  /** Time of evaluation, taken from the injected clock. */
  evaluatedAt: number;
}

export interface GeofenceServiceOptions {
  /** Defaults to `DEFAULT_GEOFENCE`. */
  geofence?: GeofenceConfig;
  /** Defaults to `DEFAULT_COOLDOWN_MS`. */
  cooldownMs?: number;
  /** Accuracy in metres above which a reading is uncertain. Defaults to the geofence radius. */
  accuracyThresholdMeters?: number;
  /** Injected clock for deterministic tests. Defaults to `Date.now`. */
  now?: () => number;
}

export interface GeofenceService {
  evaluate(reading: GeofenceReading): GeofenceEvaluation;
  getState(): GeofenceState;
}

function assertReading(value: GeofenceReading): GeofenceReading {
  if (typeof value !== 'object' || value === null) {
    throw new ValidationError('reading must be an object with coordinates, accuracy and timestamp');
  }

  assertValidCoordinates(value);
  assertNonNegativeNumber(value.accuracy, 'accuracy');

  const timestamp = assertFiniteNumber(value.timestamp, 'timestamp');
  if (!Number.isInteger(timestamp) || timestamp < 0) {
    throw new ValidationError('timestamp must be a non-negative integer of epoch milliseconds');
  }

  return value;
}

export function createGeofenceService(options: GeofenceServiceOptions = {}): GeofenceService {
  const geofence: GeofenceConfig = options.geofence ?? DEFAULT_GEOFENCE;
  assertValidCoordinates(geofence);
  assertNonNegativeNumber(geofence.radiusMeters, 'geofence.radiusMeters');

  const cooldownMs = assertNonNegativeNumber(options.cooldownMs ?? DEFAULT_COOLDOWN_MS, 'cooldownMs');
  const accuracyThresholdMeters = assertNonNegativeNumber(
    options.accuracyThresholdMeters ?? geofence.radiusMeters,
    'accuracyThresholdMeters',
  );
  const now = options.now ?? Date.now;

  let state: GeofenceState = 'outside';
  let lastNotificationAt: number | null = null;

  function evaluate(reading: GeofenceReading): GeofenceEvaluation {
    const validated = assertReading(reading);
    const evaluatedAt = assertFiniteNumber(now(), 'current time');
    const previousState = state;

    if (validated.accuracy > accuracyThresholdMeters) {
      return {
        status: 'uncertain',
        previousState,
        nextState: previousState,
        distanceMeters: null,
        notification: { shouldNotify: false, reason: 'uncertain-accuracy' },
        evaluatedAt,
      };
    }

    const distanceMeters = haversineMeters(validated, geofence);
    if (!Number.isFinite(distanceMeters)) {
      throw new ValidationError('distance must be a finite number of metres');
    }

    const isInside = distanceMeters <= geofence.radiusMeters + BOUNDARY_EPSILON_METERS;

    if (!isInside) {
      state = 'outside';

      return {
        status: 'outside',
        previousState,
        nextState: state,
        distanceMeters,
        notification: { shouldNotify: false, reason: 'outside' },
        evaluatedAt,
      };
    }

    state = 'inside';

    if (previousState === 'inside') {
      return {
        status: 'inside',
        previousState,
        nextState: state,
        distanceMeters,
        notification: { shouldNotify: false, reason: 'duplicate-inside' },
        evaluatedAt,
      };
    }

    const sinceLastNotification =
      lastNotificationAt === null ? Number.POSITIVE_INFINITY : evaluatedAt - lastNotificationAt;

    if (sinceLastNotification < cooldownMs) {
      return {
        status: 'inside',
        previousState,
        nextState: state,
        distanceMeters,
        notification: { shouldNotify: false, reason: 'cooldown-active' },
        evaluatedAt,
      };
    }

    lastNotificationAt = evaluatedAt;

    return {
      status: 'inside',
      previousState,
      nextState: state,
      distanceMeters,
      notification: { shouldNotify: true, reason: 'enter' },
      evaluatedAt,
    };
  }

  return {
    evaluate,
    getState: () => state,
  };
}
