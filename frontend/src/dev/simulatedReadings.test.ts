import { describe, expect, it } from 'vitest'
import { INITIAL_MACHINE_STATE, evaluateReading, toMachineConfig } from '../geofence/machine'
import { demoGeofence } from '../test/fixtures'
import {
  OUTSIDE_RADIUS_MULTIPLIER,
  SIMULATED_ACCURACY_METERS,
  exitThenReentry,
  insideReading,
  outsideReading,
} from './simulatedReadings'

/**
 * The builders only produce readings. Every expectation below is therefore expressed through
 * the real state machine, which is what decides whether a simulated reading is an entry.
 */

const config = toMachineConfig(demoGeofence)
const NOW = 1_700_000_000_000

function evaluate(
  reading: ReturnType<typeof insideReading>,
  state = INITIAL_MACHINE_STATE,
) {
  return evaluateReading(reading, state, config, { now: NOW })
}

describe('simulated readings', () => {
  it('takes the inside reading from the geofence the API returned', () => {
    const fix = insideReading(demoGeofence, NOW)

    expect(fix.latitude).toBe(demoGeofence.latitude)
    expect(fix.longitude).toBe(demoGeofence.longitude)
    expect(fix.accuracyMeters).toBe(SIMULATED_ACCURACY_METERS)
    expect(fix.accuracyMeters).toBeLessThanOrEqual(demoGeofence.policy.accuracyThresholdMeters)
    expect(fix.occurredAt).toBe(NOW)
  })

  it('classifies the inside reading as a confirmed entry', () => {
    const result = evaluate(insideReading(demoGeofence, NOW))

    expect(result.rejection).toBeNull()
    expect(result.status).toBe('inside')
    expect(result.distanceMeters).toBe(0)
    expect(result.notification).toEqual({ shouldNotify: true, reason: 'enter' })
  })

  it('classifies the outside reading as a usable exit, not an uncertain one', () => {
    const result = evaluate(outsideReading(demoGeofence, NOW))

    // Usable means it is not rejected as stale, future, out of order or invalid, and its
    // accuracy is inside the policy threshold — so it is a real confirmed exit.
    expect(result.rejection).toBeNull()
    expect(result.status).toBe('outside')
    expect(result.notification.shouldNotify).toBe(false)
    expect(result.distanceMeters).toBeCloseTo(
      demoGeofence.radiusMeters * OUTSIDE_RADIUS_MULTIPLIER,
      6,
    )
    expect(result.distanceMeters).toBeGreaterThan(demoGeofence.radiusMeters)
  })

  it('pairs the exit and the re-entry at one observation time, exit first', () => {
    const [exit, reentry] = exitThenReentry(demoGeofence, NOW)

    expect(exit.occurredAt).toBe(NOW)
    expect(reentry.occurredAt).toBe(NOW)
    expect(evaluate(exit).status).toBe('outside')
    expect(evaluate(reentry).status).toBe('inside')
  })

  it('throttles the re-entry that follows an exit inside the cooldown window', () => {
    const entry = evaluate(insideReading(demoGeofence, NOW))
    const [exit, reentry] = exitThenReentry(demoGeofence, NOW)

    const afterExit = evaluate(exit, entry.state)
    const afterReentry = evaluate(reentry, afterExit.state)

    expect(entry.notification.shouldNotify).toBe(true)
    expect(afterExit.state.confirmedState).toBe('outside')
    // The exit re-armed entry eligibility, so this is not a duplicate — but the cooldown that
    // started with the first entry has not elapsed, so no second notification is sent.
    expect(afterReentry.status).toBe('inside')
    expect(afterReentry.notification).toEqual({ shouldNotify: false, reason: 'cooldown-active' })
    expect(afterReentry.state.confirmedState).toBe('inside')
  })
})
