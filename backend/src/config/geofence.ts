/**
 * Geofence configuration defaults.
 *
 * This module is the single source of truth for the fixed demo geofence: the
 * coordinates and radius below must not be duplicated in other modules.
 */
export interface GeofenceConfig {
  readonly id: string;
  readonly name: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly radiusMeters: number;
}

export const DEFAULT_GEOFENCE: GeofenceConfig = Object.freeze({
  id: 'demo-geofence',
  name: 'Demo Geofence',
  latitude: 18.56788997616755,
  longitude: 73.91932741340476,
  radiusMeters: 30,
});

/** Longest interval between two notifications for the same device (60 seconds). */
export const DEFAULT_COOLDOWN_MS = 60_000;

/**
 * Accuracy (metres) above which a reading is not trustworthy.
 *
 * Numerically equal to the radius of the demo geofence, but conceptually a separate
 * policy: it can diverge from the radius for a different geofence.
 */
export const DEFAULT_ACCURACY_THRESHOLD_METERS = 30;

/** Visitor policies shared by the client state machine and the notification API. */
export interface GeofencePolicy {
  /** Minimum time between two notifications for the same device/session. */
  readonly cooldownMs: number;
  /** Readings with worse horizontal accuracy are uncertain and are rejected by the API. */
  readonly accuracyThresholdMeters: number;
}

export const DEFAULT_GEOFENCE_POLICY: GeofencePolicy = Object.freeze({
  cooldownMs: DEFAULT_COOLDOWN_MS,
  accuracyThresholdMeters: DEFAULT_ACCURACY_THRESHOLD_METERS,
});

/** A configured geofence plus the status and policy the API reports and enforces. */
export interface GeofenceDescriptor extends GeofenceConfig {
  readonly enabled: boolean;
  readonly policy: GeofencePolicy;
}

/** The default gateway: the only geofence this assessment ships with. */
export const DEFAULT_GEOFENCE_DESCRIPTOR: GeofenceDescriptor = Object.freeze({
  ...DEFAULT_GEOFENCE,
  enabled: true,
  policy: DEFAULT_GEOFENCE_POLICY,
});

/**
 * Configured geofences. There is deliberately no editable geofence CRUD: the assessment
 * requires a single fixed demo geofence, and the registry exists so the API can look an
 * id up and reject unknown or disabled ones.
 */
export const GEOFENCES: readonly GeofenceDescriptor[] = Object.freeze([DEFAULT_GEOFENCE_DESCRIPTOR]);

export function listGeofences(): readonly GeofenceDescriptor[] {
  return GEOFENCES;
}

export function findGeofenceById(id: string): GeofenceDescriptor | undefined {
  return GEOFENCES.find((geofence) => geofence.id === id);
}
