import { ValidationError } from './errors.js';

/**
 * Asserts that a value is a finite number. Strings and other coercible values are
 * rejected on purpose: nothing in the geofence pipeline silently converts input.
 */
export function assertFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ValidationError(`${label} must be a finite number`);
  }

  return value;
}

/** Finite number that must not be negative (radius, accuracy, cooldown, timestamp). */
export function assertNonNegativeNumber(value: unknown, label: string): number {
  const parsed = assertFiniteNumber(value, label);

  if (parsed < 0) {
    throw new ValidationError(`${label} must be zero or greater`);
  }

  return parsed;
}
