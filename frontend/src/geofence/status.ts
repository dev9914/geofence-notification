import {
  GEOLOCATION_DENIED_MESSAGE,
  GEOLOCATION_ERROR_MESSAGE,
  GEOLOCATION_TIMEOUT_MESSAGE,
  GEOLOCATION_UNAVAILABLE_MESSAGE,
  GEOLOCATION_UNSUPPORTED_MESSAGE,
  type GeolocationStatus,
} from '../hooks/useGeolocation'
import type { VisitorMachineState } from './machine'

/** Every state the visitor interface can show. */
export type VisitorStatusKey =
  | 'unsupported'
  | 'denied'
  | 'idle'
  | 'waiting'
  | 'unavailable'
  | 'timeout'
  | 'geolocation-error'
  | 'inside'
  | 'outside'
  | 'uncertain'

export type VisitorStatusTone = 'neutral' | 'positive' | 'warning' | 'negative'

export interface VisitorStatusView {
  key: VisitorStatusKey
  label: string
  detail: string
  tone: VisitorStatusTone
}

export interface VisitorStatusInput {
  isTracking: boolean
  geolocationStatus: GeolocationStatus
  machine: VisitorMachineState
  /** Whether at least one position has been received. */
  hasFix: boolean
}

/**
 * Maps the geolocation state and the geofence machine state onto the single status the
 * header shows.
 *
 * Browser-level problems take precedence over the geofence classification, because a
 * position we never received cannot be classified.
 */
export function describeVisitorStatus(input: VisitorStatusInput): VisitorStatusView {
  const { isTracking, geolocationStatus, machine, hasFix } = input

  if (geolocationStatus === 'unsupported') {
    return {
      key: 'unsupported',
      label: 'Location unavailable',
      detail: GEOLOCATION_UNSUPPORTED_MESSAGE,
      tone: 'negative',
    }
  }

  if (geolocationStatus === 'denied') {
    return {
      key: 'denied',
      label: 'Location permission denied',
      detail: GEOLOCATION_DENIED_MESSAGE,
      tone: 'negative',
    }
  }

  if (!isTracking) {
    return {
      key: 'idle',
      label: 'Not tracking',
      detail: 'Tracking is stopped. Start tracking to watch your GPS position.',
      tone: 'neutral',
    }
  }

  if (geolocationStatus === 'unavailable') {
    return {
      key: 'unavailable',
      label: 'Location unavailable',
      detail: GEOLOCATION_UNAVAILABLE_MESSAGE,
      tone: 'negative',
    }
  }

  if (geolocationStatus === 'timeout') {
    return {
      key: 'timeout',
      label: 'Location unavailable',
      detail: GEOLOCATION_TIMEOUT_MESSAGE,
      tone: 'warning',
    }
  }

  if (geolocationStatus === 'geolocation-error') {
    return {
      key: 'geolocation-error',
      label: 'Location unavailable',
      detail: GEOLOCATION_ERROR_MESSAGE,
      tone: 'negative',
    }
  }

  if (!hasFix) {
    return {
      key: 'waiting',
      label: 'Waiting for permission',
      detail:
        'Approve the browser location prompt if it appears, then wait for the first GPS fix. Location access requires a secure context such as HTTPS or localhost.',
      tone: 'warning',
    }
  }

  if (machine.status === 'inside') {
    return {
      key: 'inside',
      label: 'Inside the geofence',
      detail: 'Your reported position is inside the geofence radius.',
      tone: 'positive',
    }
  }

  if (machine.status === 'uncertain') {
    return {
      key: 'uncertain',
      label: 'Uncertain position',
      detail:
        'GPS accuracy is worse than the policy threshold, so this reading cannot confirm your position.',
      tone: 'warning',
    }
  }

  return {
    key: 'outside',
    label: 'Outside the geofence',
    detail: 'Your reported position is outside the geofence radius.',
    tone: 'neutral',
  }
}
