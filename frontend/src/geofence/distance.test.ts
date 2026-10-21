import { describe, expect, it } from 'vitest'
import {
  BOUNDARY_EPSILON_METERS,
  EARTH_RADIUS_METERS,
  haversineMeters,
  isFiniteNumber,
  isValidCoordinates,
  isValidLatitude,
  isValidLongitude,
  isWithinRadius,
} from './distance'

/** Degrees of latitude per metre (same-longitude offsets only need this term). */
const DEGREES_PER_METRE = 180 / Math.PI / EARTH_RADIUS_METERS

/** A point `meters` due north of `origin` on the same meridian. */
function northOf(origin: { latitude: number; longitude: number }, meters: number) {
  return {
    latitude: origin.latitude + meters * DEGREES_PER_METRE,
    longitude: origin.longitude,
  }
}

const centre = { latitude: 18.56788997616755, longitude: 73.91932741340476 }

describe('haversineMeters', () => {
  it('returns 0 for identical points', () => {
    expect(haversineMeters(centre, centre)).toBe(0)
  })

  it('matches the analytic distance for one degree of latitude', () => {
    const expected = EARTH_RADIUS_METERS * (Math.PI / 180)

    expect(haversineMeters({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 })).toBeCloseTo(
      expected,
      6,
    )
  })

  it('measures a due-north offset of 25 m as 25 m', () => {
    expect(haversineMeters(centre, northOf(centre, 25))).toBeCloseTo(25, 6)
  })

  it('rejects non-finite or out-of-range coordinates', () => {
    expect(() => haversineMeters({ latitude: Number.NaN, longitude: 0 }, centre)).toThrow(RangeError)
    expect(() => haversineMeters({ latitude: 91, longitude: 0 }, centre)).toThrow(RangeError)
    expect(() => haversineMeters(centre, { latitude: 0, longitude: 181 })).toThrow(RangeError)
  })
})

describe('isWithinRadius and the 30 metre boundary', () => {
  it('treats a point exactly on the radius as inside', () => {
    const distance = haversineMeters(centre, northOf(centre, 30))

    // Building a point on the boundary lands within floating-point noise of 30 m, so the
    // tolerance (not luck) is what keeps the classification inside.
    expect(distance).toBeCloseTo(30, 6)
    expect(isWithinRadius(distance, 30)).toBe(true)
    expect(isWithinRadius(30, 30)).toBe(true)
    expect(isWithinRadius(30 + BOUNDARY_EPSILON_METERS / 2, 30)).toBe(true)
  })

  it('treats a point beyond the radius as outside', () => {
    expect(isWithinRadius(haversineMeters(centre, northOf(centre, 30.01)), 30)).toBe(false)
    expect(isWithinRadius(30.001, 30)).toBe(false)
    expect(isWithinRadius(40, 30)).toBe(false)
  })

  it('rejects non-finite distances instead of guessing', () => {
    expect(isWithinRadius(Number.NaN, 30)).toBe(false)
    expect(isWithinRadius(10, Number.POSITIVE_INFINITY)).toBe(false)
  })
})

describe('coordinate validation', () => {
  it('accepts only finite in-range numbers', () => {
    expect(isValidLatitude(0)).toBe(true)
    expect(isValidLatitude(-90)).toBe(true)
    expect(isValidLatitude(90)).toBe(true)
    expect(isValidLatitude(90.1)).toBe(false)
    expect(isValidLatitude('18.5')).toBe(false)
    expect(isValidLatitude(Number.NaN)).toBe(false)
    expect(isValidLongitude(180)).toBe(true)
    expect(isValidLongitude(-180.5)).toBe(false)
    expect(isValidLongitude(null)).toBe(false)
    expect(isFiniteNumber(0)).toBe(true)
    expect(isFiniteNumber(Number.POSITIVE_INFINITY)).toBe(false)
  })

  it('requires both coordinates on the object', () => {
    expect(isValidCoordinates(centre)).toBe(true)
    expect(isValidCoordinates({ latitude: 1 })).toBe(false)
    expect(isValidCoordinates(null)).toBe(false)
    expect(isValidCoordinates('18.5,73.9')).toBe(false)
  })
})
