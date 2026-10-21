import { describe, expect, it } from 'vitest'
import { EARTH_RADIUS_METERS } from './distance'
import {
  INITIAL_MACHINE_STATE,
  NOTIFICATION_REASON_TEXT,
  evaluateReading,
  toMachineConfig,
  type GeofenceReading,
  type MachineConfig,
  type VisitorMachineState,
} from './machine'
import { demoGeofence } from '../test/fixtures'

const DEGREES_PER_METRE = 180 / Math.PI / EARTH_RADIUS_METERS
const CENTRE = { latitude: demoGeofence.latitude, longitude: demoGeofence.longitude }

const config: MachineConfig = {
  geofenceId: demoGeofence.id,
  latitude: demoGeofence.latitude,
  longitude: demoGeofence.longitude,
  radiusMeters: demoGeofence.radiusMeters,
  cooldownMs: demoGeofence.policy.cooldownMs,
  accuracyThresholdMeters: demoGeofence.policy.accuracyThresholdMeters,
}

/** Fixed wall clock so the cooldown is deterministic. */
const NOW = 1_700_000_000_000

function northOf(meters: number) {
  return {
    latitude: CENTRE.latitude + meters * DEGREES_PER_METRE,
    longitude: CENTRE.longitude,
  }
}

/** 10 m from the centre: comfortably inside the 30 m radius. */
function inside(occurredAt = NOW, accuracyMeters = 5): GeofenceReading {
  return { ...northOf(10), accuracyMeters, occurredAt }
}

/** 120 m from the centre: comfortably outside. */
function outside(occurredAt = NOW, accuracyMeters = 5): GeofenceReading {
  return { ...northOf(120), accuracyMeters, occurredAt }
}

function evaluate(reading: GeofenceReading, state: VisitorMachineState, now = NOW) {
  return evaluateReading(reading, state, config, { now })
}

describe('toMachineConfig', () => {
  it('reads the canonical configuration out of the API response', () => {
    expect(toMachineConfig(demoGeofence)).toEqual(config)
  })
})

describe('entry transitions', () => {
  it('notifies once on a confirmed entry', () => {
    const result = evaluate(inside(), INITIAL_MACHINE_STATE)

    expect(result.status).toBe('inside')
    expect(result.previousState).toBe('outside')
    expect(result.nextState).toBe('inside')
    expect(result.notification).toEqual({ shouldNotify: true, reason: 'enter' })
    expect(result.rejection).toBeNull()
    expect(result.state.lastNotificationAt).toBe(NOW)
  })

  it('treats exactly 30 m as inside', () => {
    const result = evaluate({ ...northOf(30), accuracyMeters: 5, occurredAt: NOW }, INITIAL_MACHINE_STATE)

    expect(result.distanceMeters).toBeCloseTo(30, 6)
    expect(result.status).toBe('inside')
    expect(result.notification.shouldNotify).toBe(true)
  })

  it('treats a point just beyond the radius as outside', () => {
    const result = evaluate(
      { ...northOf(30.01), accuracyMeters: 5, occurredAt: NOW },
      INITIAL_MACHINE_STATE,
    )

    expect(result.status).toBe('outside')
    expect(result.notification).toEqual({ shouldNotify: false, reason: 'outside' })
  })

  it('suppresses duplicate notifications while the visitor stays inside', () => {
    const entry = evaluate(inside(), INITIAL_MACHINE_STATE)
    const stillInside = evaluate(inside(NOW + 1_000), entry.state, NOW + 1_000)

    expect(stillInside.status).toBe('inside')
    expect(stillInside.notification).toEqual({ shouldNotify: false, reason: 'duplicate-inside' })
    expect(stillInside.state.lastNotificationAt).toBe(NOW)
  })

  it('re-arms entry eligibility after a confirmed exit', () => {
    const entry = evaluate(inside(), INITIAL_MACHINE_STATE)
    const exit = evaluate(outside(NOW + 1_000), entry.state, NOW + 1_000)

    expect(exit.status).toBe('outside')
    expect(exit.nextState).toBe('outside')
    expect(exit.notification.reason).toBe('outside')

    const secondEntry = evaluate(inside(NOW + 61_000), exit.state, NOW + 61_000)

    expect(secondEntry.notification).toEqual({ shouldNotify: true, reason: 'enter' })
  })
})

describe('cooldown', () => {
  it('throttles an entry inside the cooldown window without replaying it', () => {
    const entry = evaluate(inside(), INITIAL_MACHINE_STATE)
    const exit = evaluate(outside(NOW + 1_000), entry.state, NOW + 1_000)
    const throttled = evaluate(inside(NOW + 2_000), exit.state, NOW + 2_000)

    expect(throttled.status).toBe('inside')
    expect(throttled.notification).toEqual({ shouldNotify: false, reason: 'cooldown-active' })
    // The throttled entry still moves the machine inside, so it is not replayed while the
    // visitor keeps standing inside.
    expect(throttled.nextState).toBe('inside')
    expect(throttled.state.lastNotificationAt).toBe(NOW)

    const later = evaluate(inside(NOW + 30_000), throttled.state, NOW + 30_000)

    expect(later.notification).toEqual({ shouldNotify: false, reason: 'duplicate-inside' })
  })

  it('allows the next entry once the cooldown has elapsed', () => {
    const entry = evaluate(inside(), INITIAL_MACHINE_STATE)
    const exit = evaluate(outside(NOW + 1_000), entry.state, NOW + 1_000)
    const afterCooldown = evaluate(inside(NOW + 60_000), exit.state, NOW + 60_000)

    expect(afterCooldown.notification).toEqual({ shouldNotify: true, reason: 'enter' })
    expect(afterCooldown.state.lastNotificationAt).toBe(NOW + 60_000)
  })

  it('measures the cooldown with the wall clock rather than the device timestamp', () => {
    const entry = evaluate(inside(), INITIAL_MACHINE_STATE)
    const exit = evaluate(outside(NOW + 1_000), entry.state, NOW + 1_000)
    // The device reports a timestamp 4 s ahead of the wall clock, which is within the
    // tolerated skew: the cooldown is still measured against `now`, so it is not bypassed.
    const skewed = evaluate(
      { ...northOf(10), accuracyMeters: 5, occurredAt: NOW + 4_000 },
      exit.state,
      NOW + 2_000,
    )

    expect(skewed.rejection).toBeNull()
    expect(skewed.notification).toEqual({ shouldNotify: false, reason: 'cooldown-active' })
  })

  it('rejects a device clock far ahead instead of letting it bypass the cooldown', () => {
    const entry = evaluate(inside(), INITIAL_MACHINE_STATE)
    const exit = evaluate(outside(NOW + 1_000), entry.state, NOW + 1_000)
    const replayed = evaluate(
      { ...northOf(10), accuracyMeters: 5, occurredAt: NOW + 9_000_000 },
      exit.state,
      NOW + 2_000,
    )

    expect(replayed.rejection).toBe('future-reading')
    expect(replayed.notification.shouldNotify).toBe(false)
  })
})

describe('accuracy and uncertainty', () => {
  it('reports an inaccurate reading as uncertain without confirming an entry', () => {
    const result = evaluate(inside(NOW, 35), INITIAL_MACHINE_STATE)

    expect(result.status).toBe('uncertain')
    expect(result.distanceMeters).not.toBeNull()
    expect(result.notification).toEqual({ shouldNotify: false, reason: 'uncertain-accuracy' })
    expect(result.nextState).toBe('outside')
    expect(result.state.confirmedState).toBe('outside')
  })

  it('never treats an uncertain reading as a confirmed exit', () => {
    const entry = evaluate(inside(), INITIAL_MACHINE_STATE)
    const uncertainOutside = evaluate(outside(NOW + 1_000, 40), entry.state, NOW + 1_000)

    expect(uncertainOutside.status).toBe('uncertain')
    expect(uncertainOutside.nextState).toBe('inside')
    expect(uncertainOutside.state.confirmedState).toBe('inside')
  })

  it('trusts a reading whose accuracy is exactly the threshold', () => {
    const result = evaluate(inside(NOW, config.accuracyThresholdMeters), INITIAL_MACHINE_STATE)

    expect(result.status).toBe('inside')
    expect(result.notification).toEqual({ shouldNotify: true, reason: 'enter' })
  })
})

describe('reading hygiene', () => {
  it('rejects a stale reading without touching the state', () => {
    const result = evaluate(inside(NOW - 30_001), INITIAL_MACHINE_STATE)

    expect(result.rejection).toBe('stale-reading')
    expect(result.notification).toEqual({ shouldNotify: false, reason: 'rejected' })
    expect(result.state).toBe(INITIAL_MACHINE_STATE)
  })

  it('accepts a reading exactly at the maximum age', () => {
    const result = evaluate(inside(NOW - 30_000), INITIAL_MACHINE_STATE)

    expect(result.rejection).toBeNull()
    expect(result.status).toBe('inside')
  })

  it('rejects a reading from a device clock too far ahead', () => {
    const result = evaluate(inside(NOW + 5_001), INITIAL_MACHINE_STATE)

    expect(result.rejection).toBe('future-reading')
    expect(result.state).toBe(INITIAL_MACHINE_STATE)
  })

  it('rejects an out-of-order reading', () => {
    const entry = evaluate(inside(NOW), INITIAL_MACHINE_STATE)
    const replayed = evaluate(inside(NOW - 1_000), entry.state, NOW)

    expect(replayed.rejection).toBe('out-of-order')
    expect(replayed.state).toBe(entry.state)
  })

  it('rejects a reading with unusable coordinates or accuracy', () => {
    expect(evaluate({ ...northOf(10), accuracyMeters: Number.NaN, occurredAt: NOW }, INITIAL_MACHINE_STATE).rejection).toBe(
      'invalid-reading',
    )
    expect(
      evaluate({ latitude: 200, longitude: 73, accuracyMeters: 5, occurredAt: NOW }, INITIAL_MACHINE_STATE).rejection,
    ).toBe('invalid-reading')
    expect(evaluate(inside(NOW, -1), INITIAL_MACHINE_STATE).rejection).toBe('invalid-reading')
  })

  it('throws when the geofence configuration or the clock is unusable', () => {
    expect(() =>
      evaluateReading(inside(), INITIAL_MACHINE_STATE, { ...config, radiusMeters: Number.NaN }, { now: NOW }),
    ).toThrow(RangeError)
    expect(() => evaluateReading(inside(), INITIAL_MACHINE_STATE, config, { now: Number.NaN })).toThrow(
      RangeError,
    )
  })
})

describe('notification reason copy', () => {
  it('covers every reason the machine can emit', () => {
    expect(Object.keys(NOTIFICATION_REASON_TEXT).sort()).toEqual([
      'cooldown-active',
      'duplicate-inside',
      'enter',
      'outside',
      'rejected',
      'uncertain-accuracy',
    ])
  })
})
