import { describe, expect, it } from 'vitest';
import { DEFAULT_GEOFENCE } from './geofence.js';

describe('DEFAULT_GEOFENCE', () => {
  it('matches the fixed assessment defaults', () => {
    expect(DEFAULT_GEOFENCE.id).toBe('demo-geofence');
    expect(DEFAULT_GEOFENCE.name).toBe('Demo Geofence');
    expect(DEFAULT_GEOFENCE.latitude).toBe(18.56788997616755);
    expect(DEFAULT_GEOFENCE.longitude).toBe(73.91932741340476);
    expect(DEFAULT_GEOFENCE.radiusMeters).toBe(30);
  });

  it('is immutable so the shared defaults cannot be mutated at runtime', () => {
    expect(Object.isFrozen(DEFAULT_GEOFENCE)).toBe(true);
  });
});
