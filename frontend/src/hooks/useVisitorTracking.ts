import { useCallback, useEffect, useRef, useState } from 'react'
import { createOpaqueId, getVisitorSessionId } from '../geofence/session'
import {
  INITIAL_MACHINE_STATE,
  evaluateReading,
  toMachineConfig,
  type MachineConfig,
  type ReadingEvaluation,
  type VisitorMachineState,
} from '../geofence/machine'
import { buildEntryPayload } from '../geofence/payload'
import type { Geofence } from '../api/types'
import { useGeolocation, type GeolocationFix, type UseGeolocationResult } from './useGeolocation'
import { useNotificationRecorder, type NotificationRecording } from './useNotificationRecorder'

/**
 * Ties the real browser GPS stream to the geofence state machine and the notification API.
 *
 * Each position the browser reports is evaluated by the pure machine, and only a confirmed
 * entry produces a `POST /api/v1/notifications`. The machine (not React) decides whether a
 * reading is an entry, so re-renders, repeated updates and retries cannot each create a
 * notification.
 */

export interface VisitorTracking {
  machine: VisitorMachineState
  /** Result of the most recent evaluated reading, or `null` before the first one. */
  evaluation: ReadingEvaluation | null
  geolocation: UseGeolocationResult
  recording: NotificationRecording
  /** True when the geofence configuration is loaded, enabled and tracking may start. */
  canTrack: boolean
  /** True when the backend reports the configured geofence as disabled. */
  isDisabled: boolean
  /**
   * Most recent synthetic reading applied through `applyFix`, or `null` when the latest
   * reading came from the browser. Only the development test mode ever sets it.
   */
  simulatedFix: GeolocationFix | null
  /**
   * Evaluates one reading exactly as a browser fix would: same state machine, same duplicate
   * and cooldown rules, same notification recorder. Used by the development-only GPS test
   * mode; the backend still validates whatever is submitted through it.
   */
  applyFix: (fix: GeolocationFix) => void
  start: () => void
  stop: () => void
}

export function useVisitorTracking(geofence: Geofence | null): VisitorTracking {
  const recording = useNotificationRecorder()
  const recordEntry = recording.record

  const [machine, setMachine] = useState<VisitorMachineState>(INITIAL_MACHINE_STATE)
  const [evaluation, setEvaluation] = useState<ReadingEvaluation | null>(null)
  const [simulatedFix, setSimulatedFix] = useState<GeolocationFix | null>(null)

  const machineRef = useRef<VisitorMachineState>(INITIAL_MACHINE_STATE)
  const configRef = useRef<MachineConfig | null>(null)

  useEffect(() => {
    configRef.current =
      geofence !== null && geofence.enabled ? toMachineConfig(geofence) : null
  }, [geofence])

  /** The single path every reading takes, whether it came from the browser or a test click. */
  const evaluateFix = useCallback(
    (fix: GeolocationFix) => {
      const config = configRef.current

      // Without a loaded configuration there is no radius to measure against, so the reading
      // is left unclassified rather than guessed.
      if (config === null) {
        return
      }

      const result = evaluateReading(
        {
          latitude: fix.latitude,
          longitude: fix.longitude,
          accuracyMeters: fix.accuracyMeters,
          occurredAt: fix.occurredAt,
        },
        machineRef.current,
        config,
        { now: Date.now() },
      )

      machineRef.current = result.state
      setMachine(result.state)
      setEvaluation(result)

      if (!result.notification.shouldNotify) {
        return
      }

      recordEntry(
        buildEntryPayload({
          eventId: createOpaqueId(),
          sessionId: getVisitorSessionId(),
          geofenceId: config.geofenceId,
          reading: {
            latitude: fix.latitude,
            longitude: fix.longitude,
            accuracyMeters: fix.accuracyMeters,
            occurredAt: fix.occurredAt,
          },
        }),
      )
    },
    [recordEntry],
  )

  const handleBrowserFix = useCallback(
    (fix: GeolocationFix) => {
      setSimulatedFix(null)
      evaluateFix(fix)
    },
    [evaluateFix],
  )

  const applyFix = useCallback(
    (fix: GeolocationFix) => {
      setSimulatedFix(fix)
      evaluateFix(fix)
    },
    [evaluateFix],
  )

  const browserGeolocation = useGeolocation({ onFix: handleBrowserFix })

  const isDisabled = geofence !== null && !geofence.enabled
  const canTrack = geofence !== null && geofence.enabled

  return {
    machine,
    evaluation,
    geolocation: browserGeolocation,
    recording,
    canTrack,
    isDisabled,
    simulatedFix,
    applyFix,
    start: browserGeolocation.start,
    stop: browserGeolocation.stop,
  }
}
