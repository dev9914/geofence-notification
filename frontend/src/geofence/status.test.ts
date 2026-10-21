import { describe, expect, it } from 'vitest'
import {
  GEOLOCATION_DENIED_MESSAGE,
  GEOLOCATION_TIMEOUT_MESSAGE,
  GEOLOCATION_UNAVAILABLE_MESSAGE,
  GEOLOCATION_UNSUPPORTED_MESSAGE,
} from '../hooks/useGeolocation'
import { describeVisitorStatus, type VisitorStatusInput } from './status'
import { INITIAL_MACHINE_STATE, type VisitorMachineState } from './machine'

function view(overrides: Partial<VisitorStatusInput> = {}) {
  return describeVisitorStatus({
    isTracking: false,
    geolocationStatus: 'idle',
    machine: INITIAL_MACHINE_STATE,
    hasFix: false,
    ...overrides,
  })
}

function machineWith(overrides: Partial<VisitorMachineState>): VisitorMachineState {
  return { ...INITIAL_MACHINE_STATE, ...overrides }
}

describe('describeVisitorStatus', () => {
  it('reports an unsupported browser', () => {
    const status = view({ geolocationStatus: 'unsupported' })

    expect(status.key).toBe('unsupported')
    expect(status.tone).toBe('negative')
    expect(status.detail).toBe(GEOLOCATION_UNSUPPORTED_MESSAGE)
  })

  it('gives browser-level problems precedence over the geofence classification', () => {
    const status = view({
      isTracking: true,
      hasFix: true,
      geolocationStatus: 'unsupported',
      machine: machineWith({ status: 'inside' }),
    })

    expect(status.key).toBe('unsupported')
  })

  it('reports a denied permission', () => {
    const status = view({ geolocationStatus: 'denied' })

    expect(status.key).toBe('denied')
    expect(status.tone).toBe('negative')
    expect(status.detail).toBe(GEOLOCATION_DENIED_MESSAGE)
  })

  it('reports that tracking is stopped', () => {
    expect(view().key).toBe('idle')
    expect(view({ geolocationStatus: 'tracking' }).key).toBe('idle')
  })

  it('reports unavailable, timeout and unexpected geolocation errors', () => {
    const unavailable = view({ isTracking: true, geolocationStatus: 'unavailable' })
    const timeout = view({ isTracking: true, geolocationStatus: 'timeout' })
    const unexpected = view({ isTracking: true, geolocationStatus: 'geolocation-error' })

    expect(unavailable.key).toBe('unavailable')
    expect(unavailable.detail).toBe(GEOLOCATION_UNAVAILABLE_MESSAGE)
    expect(timeout.key).toBe('timeout')
    expect(timeout.tone).toBe('warning')
    expect(timeout.detail).toBe(GEOLOCATION_TIMEOUT_MESSAGE)
    expect(unexpected.key).toBe('geolocation-error')
    expect(unexpected.tone).toBe('negative')
  })

  it('waits for the first fix and mentions the secure context requirement', () => {
    const status = view({ isTracking: true, geolocationStatus: 'waiting' })

    expect(status.key).toBe('waiting')
    expect(status.label).toBe('Waiting for permission')
    expect(status.detail).toMatch(/HTTPS or localhost/)
  })

  it('reports inside, uncertain and outside once a fix exists', () => {
    const inside = view({
      isTracking: true,
      hasFix: true,
      geolocationStatus: 'tracking',
      machine: machineWith({ status: 'inside' }),
    })
    const uncertain = view({
      isTracking: true,
      hasFix: true,
      geolocationStatus: 'tracking',
      machine: machineWith({ status: 'uncertain' }),
    })
    const outside = view({
      isTracking: true,
      hasFix: true,
      geolocationStatus: 'tracking',
      machine: machineWith({ status: 'outside' }),
    })

    expect(inside.key).toBe('inside')
    expect(inside.tone).toBe('positive')
    expect(uncertain.key).toBe('uncertain')
    expect(uncertain.tone).toBe('warning')
    expect(outside.key).toBe('outside')
  })
})
