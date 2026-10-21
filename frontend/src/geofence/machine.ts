import { MAX_FUTURE_SKEW_MS, MAX_READING_AGE_MS } from '../config/policy'
import {
  haversineMeters,
  isFiniteNumber,
  isValidCoordinates,
  isWithinRadius,
} from './distance'
import type { Geofence } from '../api/types'

/**
 * Visitor geofence state machine.
 *
 * A pure function rather than a class: every decision is a function of the reading, the
 * previous state, the geofence configuration and an explicit clock, which keeps the entry,
 * exit, cooldown and uncertainty rules entirely testable and out of the JSX.
 *
 * States and transitions follow the backend's engine (see
 * `backend/src/services/geofenceService.ts`) so the visitor sees the same classification
 * the server will compute:
 *
 * - `confirmedState` is the last *trustworthy* classification (`inside` / `outside`).
 * - `status` is the classification of the most recent reading, which can additionally be
 *   `uncertain` when GPS accuracy is worse than the policy threshold. An uncertain reading
 *   never mutates `confirmedState`, so it can neither confirm an entry, nor count as an
 *   exit, nor spend entry eligibility.
 *
 * Notification rules:
 * - A notification is requested only on a confirmed entry: a trustworthy reading inside the
 *   radius while the machine was not already inside.
 * - While the machine stays inside, further inside readings are duplicates and are
 *   suppressed, so a notification is never emitted on every location update.
 * - A confirmed exit re-arms entry eligibility for the next entry.
 *
 * Cooldown (the backend's `policy.cooldownMs`, currently 60 s):
 * - After a notification is requested, the next one is suppressed for the cooldown window.
 * - An entry swallowed by the cooldown still moves the machine to `inside` and is *not*
 *   replayed while the visitor keeps standing inside: a new notification requires a
 *   confirmed exit, a fresh entry, and the cooldown to have elapsed.
 * - The cooldown is measured with the injected wall clock, not the device-supplied reading
 *   timestamp, so a skewed or replayed device clock cannot bypass it.
 *
 * Reading hygiene (frontend-only, because the browser can hand out cached fixes):
 * - Readings older than `maxReadingAgeMs`, further ahead than `maxFutureSkewMs`, or older
 *   than the last evaluated reading are rejected before they can affect the machine.
 */

/** Last trustworthy classification of the visitor. */
export type ConfirmedState = 'inside' | 'outside'

/** Classification of a single reading, for display. */
export type GeofenceStatus = 'inside' | 'outside' | 'uncertain'

/** Why a notification was or was not requested for a reading. */
export type NotificationReason =
  | 'enter'
  | 'duplicate-inside'
  | 'cooldown-active'
  | 'outside'
  | 'uncertain-accuracy'
  | 'rejected'

/** Why a reading was refused before it could affect the machine. */
export type ReadingRejection =
  | 'invalid-reading'
  | 'stale-reading'
  | 'future-reading'
  | 'out-of-order'

/** A geolocation sample as reported by the browser. */
export interface GeofenceReading {
  latitude: number
  longitude: number
  /** Horizontal accuracy in metres. */
  accuracyMeters: number
  /** Observation time in epoch milliseconds, from `Position.timestamp`. */
  occurredAt: number
}

/** Everything the machine needs from the geofence the backend publishes. */
export interface MachineConfig {
  geofenceId: string
  latitude: number
  longitude: number
  radiusMeters: number
  /** Backend `policy.cooldownMs`. */
  cooldownMs: number
  /** Backend `policy.accuracyThresholdMeters`. */
  accuracyThresholdMeters: number
}

export interface VisitorMachineState {
  /** Last trustworthy classification; drives entry/exit transitions. */
  confirmedState: ConfirmedState
  /** Classification of the most recent reading, for display. */
  status: GeofenceStatus
  /** Distance of the most recent usable reading from the geofence centre. */
  distanceMeters: number | null
  /** Accuracy of the most recent usable reading. */
  accuracyMeters: number | null
  /** Observation time of the most recent usable reading. */
  occurredAt: number | null
  /** Wall-clock time at which the last notification was requested. */
  lastNotificationAt: number | null
}

export interface NotificationDecision {
  shouldNotify: boolean
  reason: NotificationReason
}

export interface ReadingEvaluation {
  /** Classification of this reading. */
  status: GeofenceStatus
  /** Machine classification before this reading. */
  previousState: ConfirmedState
  /** Machine classification after this reading; unchanged for rejected readings. */
  nextState: ConfirmedState
  /** Distance in metres, or `null` when the reading could not be measured. */
  distanceMeters: number | null
  notification: NotificationDecision
  /** Set when the reading itself was unusable. */
  rejection: ReadingRejection | null
  /** Wall-clock time of evaluation. */
  evaluatedAt: number
  /** State to store for the next reading. */
  state: VisitorMachineState
}

export interface EvaluationContext {
  /** Current wall-clock time in epoch milliseconds. */
  now: number
  /** Readings older than this are stale. Defaults to the backend's 30 s rule. */
  maxReadingAgeMs?: number
  /** Readings ahead of the clock by more than this are rejected. */
  maxFutureSkewMs?: number
}

export const INITIAL_MACHINE_STATE: VisitorMachineState = Object.freeze({
  confirmedState: 'outside',
  status: 'outside',
  distanceMeters: null,
  accuracyMeters: null,
  occurredAt: null,
  lastNotificationAt: null,
})

/** Builds the machine configuration from the geofence the backend returned. */
export function toMachineConfig(geofence: Geofence): MachineConfig {
  return {
    geofenceId: geofence.id,
    latitude: geofence.latitude,
    longitude: geofence.longitude,
    radiusMeters: geofence.radiusMeters,
    cooldownMs: geofence.policy.cooldownMs,
    accuracyThresholdMeters: geofence.policy.accuracyThresholdMeters,
  }
}

function isUsableReading(reading: GeofenceReading): boolean {
  return (
    isValidCoordinates(reading) &&
    isFiniteNumber(reading.accuracyMeters) &&
    reading.accuracyMeters >= 0 &&
    isFiniteNumber(reading.occurredAt)
  )
}

function rejection(
  rejectionReason: ReadingRejection,
  state: VisitorMachineState,
  evaluatedAt: number,
): ReadingEvaluation {
  return {
    status: state.status,
    previousState: state.confirmedState,
    nextState: state.confirmedState,
    distanceMeters: state.distanceMeters,
    notification: { shouldNotify: false, reason: 'rejected' },
    rejection: rejectionReason,
    evaluatedAt,
    state,
  }
}

/**
 * Evaluates one reading against one machine state.
 *
 * @throws {RangeError} when the geofence configuration is not usable.
 */
export function evaluateReading(
  reading: GeofenceReading,
  state: VisitorMachineState,
  config: MachineConfig,
  context: EvaluationContext,
): ReadingEvaluation {
  if (!isValidCoordinates(config) || !isFiniteNumber(config.radiusMeters)) {
    throw new RangeError('evaluateReading requires a usable geofence configuration')
  }

  const { now } = context
  const maxReadingAgeMs = context.maxReadingAgeMs ?? MAX_READING_AGE_MS
  const maxFutureSkewMs = context.maxFutureSkewMs ?? MAX_FUTURE_SKEW_MS

  if (!isFiniteNumber(now)) {
    throw new RangeError('evaluateReading requires a finite clock value')
  }

  if (!isUsableReading(reading)) {
    return rejection('invalid-reading', state, now)
  }

  if (now - reading.occurredAt > maxReadingAgeMs) {
    return rejection('stale-reading', state, now)
  }

  if (reading.occurredAt - now > maxFutureSkewMs) {
    return rejection('future-reading', state, now)
  }

  if (state.occurredAt !== null && reading.occurredAt < state.occurredAt) {
    return rejection('out-of-order', state, now)
  }

  const distanceMeters = haversineMeters(reading, config)

  if (reading.accuracyMeters > config.accuracyThresholdMeters) {
    // Uncertain: report the position, but do not let this reading move the machine.
    return {
      status: 'uncertain',
      previousState: state.confirmedState,
      nextState: state.confirmedState,
      distanceMeters,
      notification: { shouldNotify: false, reason: 'uncertain-accuracy' },
      rejection: null,
      evaluatedAt: now,
      state: {
        ...state,
        status: 'uncertain',
        distanceMeters,
        accuracyMeters: reading.accuracyMeters,
        occurredAt: reading.occurredAt,
      },
    }
  }

  const baseState: VisitorMachineState = {
    ...state,
    distanceMeters,
    accuracyMeters: reading.accuracyMeters,
    occurredAt: reading.occurredAt,
  }

  if (!isWithinRadius(distanceMeters, config.radiusMeters)) {
    return {
      status: 'outside',
      previousState: state.confirmedState,
      nextState: 'outside',
      distanceMeters,
      notification: { shouldNotify: false, reason: 'outside' },
      rejection: null,
      evaluatedAt: now,
      state: { ...baseState, confirmedState: 'outside', status: 'outside' },
    }
  }

  if (state.confirmedState === 'inside') {
    return {
      status: 'inside',
      previousState: 'inside',
      nextState: 'inside',
      distanceMeters,
      notification: { shouldNotify: false, reason: 'duplicate-inside' },
      rejection: null,
      evaluatedAt: now,
      state: { ...baseState, confirmedState: 'inside', status: 'inside' },
    }
  }

  const sinceLastNotification =
    state.lastNotificationAt === null ? Number.POSITIVE_INFINITY : now - state.lastNotificationAt

  if (sinceLastNotification < config.cooldownMs) {
    return {
      status: 'inside',
      previousState: state.confirmedState,
      nextState: 'inside',
      distanceMeters,
      notification: { shouldNotify: false, reason: 'cooldown-active' },
      rejection: null,
      evaluatedAt: now,
      state: { ...baseState, confirmedState: 'inside', status: 'inside' },
    }
  }

  return {
    status: 'inside',
    previousState: state.confirmedState,
    nextState: 'inside',
    distanceMeters,
    notification: { shouldNotify: true, reason: 'enter' },
    rejection: null,
    evaluatedAt: now,
    state: { ...baseState, confirmedState: 'inside', status: 'inside', lastNotificationAt: now },
  }
}

/** Human-readable reason used by the UI when a reading was suppressed. */
export const NOTIFICATION_REASON_TEXT: Record<NotificationReason, string> = {
  enter: 'Confirmed entry — the backend is recording this notification.',
  'duplicate-inside': 'Still inside the geofence, so no new notification is sent.',
  'cooldown-active': 'Inside again during the cooldown window, so this entry is throttled.',
  outside: 'Outside the geofence radius.',
  'uncertain-accuracy': 'GPS accuracy is too poor to confirm a position.',
  rejected: 'This reading was discarded before it could change the status.',
}
