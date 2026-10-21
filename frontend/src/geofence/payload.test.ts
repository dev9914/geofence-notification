import { describe, expect, it } from 'vitest'
import { buildEntryPayload } from './payload'

const eventId = '11111111-2222-4333-8444-555555555555'

describe('buildEntryPayload', () => {
  it('emits exactly the seven keys the backend accepts', () => {
    const payload = buildEntryPayload({
      eventId,
      sessionId: 'session-1',
      geofenceId: 'demo-geofence',
      reading: {
        latitude: 18.56791,
        longitude: 73.91933,
        accuracyMeters: 4.5,
        occurredAt: 1_700_000_000_123,
      },
    })

    expect(Object.keys(payload).sort()).toEqual([
      'accuracyMeters',
      'eventId',
      'geofenceId',
      'latitude',
      'longitude',
      'occurredAt',
      'sessionId',
    ])
    expect(payload).toEqual({
      eventId,
      sessionId: 'session-1',
      geofenceId: 'demo-geofence',
      latitude: 18.56791,
      longitude: 73.91933,
      accuracyMeters: 4.5,
      occurredAt: 1_700_000_000_123,
    })
  })

  it('never sends a distance, radius or target coordinate', () => {
    const payload = buildEntryPayload({
      eventId,
      sessionId: 'session-1',
      geofenceId: 'demo-geofence',
      reading: { latitude: 18.56791, longitude: 73.91933, accuracyMeters: 4.5, occurredAt: 1 },
    })

    expect(payload).not.toHaveProperty('distanceMeters')
    expect(payload).not.toHaveProperty('radiusMeters')
    expect(payload).not.toHaveProperty('targetLatitude')
    expect(payload).not.toHaveProperty('targetLongitude')
  })

  it('rounds a fractional device timestamp to whole epoch milliseconds', () => {
    const payload = buildEntryPayload({
      eventId,
      sessionId: 'session-1',
      geofenceId: 'demo-geofence',
      reading: {
        latitude: 18.56791,
        longitude: 73.91933,
        accuracyMeters: 4.5,
        occurredAt: 1_700_000_000_123.6,
      },
    })

    expect(payload.occurredAt).toBe(1_700_000_000_124)
    expect(Number.isInteger(payload.occurredAt)).toBe(true)
  })
})
