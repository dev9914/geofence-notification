import { FlaskConical, LogIn, LogOut, RotateCcw } from 'lucide-react'
import type { Geofence } from '../api/types'
import type { GeolocationFix } from '../hooks/useGeolocation'
import { formatCoordinate } from '../utils/format'
import {
  OUTSIDE_RADIUS_MULTIPLIER,
  SIMULATED_ACCURACY_METERS,
  exitThenReentry,
  insideReading,
  outsideReading,
} from './simulatedReadings'

/**
 * Development-only GPS test helpers.
 *
 * Simulated readings are pushed into the same tracking pipeline the real browser watcher uses,
 * so they are classified by the same state machine and recorded through the same
 * `POST /api/v1/notifications` call. Nothing here writes to the database directly, and the
 * backend still validates every reading it receives.
 */

export interface DevGpsTestPanelProps {
  /** Geofence the API returned; its coordinates are the only source of the centre. */
  geofence: Geofence
  /** Pushes one reading through the visitor tracking pipeline. */
  onApplyFix: (fix: GeolocationFix) => void
}

export default function DevGpsTestPanel({ geofence, onApplyFix }: DevGpsTestPanelProps) {
  return (
    <section className="panel dev-panel" aria-labelledby="dev-test-heading">
      <header className="panel__header">
        <FlaskConical size={18} aria-hidden="true" />
        <h2 id="dev-test-heading">Development GPS test mode</h2>
      </header>

      <p className="panel__note" role="note">
        Development build only. Real GPS tracking stays the default; these buttons inject
        synthetic readings into the same state machine and notification recorder, so everything
        is still validated by the backend. Stored test entries look identical to real ones,
        because the API has no field to mark their origin.
      </p>

      <div className="controls">
        <button
          type="button"
          className="button"
          onClick={() => onApplyFix(outsideReading(geofence, Date.now()))}
        >
          <LogOut size={16} aria-hidden="true" />
          Simulate outside reading
        </button>

        <button
          type="button"
          className="button"
          onClick={() => onApplyFix(insideReading(geofence, Date.now()))}
        >
          <LogIn size={16} aria-hidden="true" />
          Simulate inside reading
        </button>

        <button
          type="button"
          className="button"
          onClick={() => {
            const [exit, reentry] = exitThenReentry(geofence, Date.now())

            onApplyFix(exit)
            onApplyFix(reentry)
          }}
        >
          <RotateCcw size={16} aria-hidden="true" />
          Simulate exit then re-entry
        </button>

        <p className="controls__help">
          The inside reading sits exactly on the geofence centre the API returned
          ({formatCoordinate(geofence.latitude)}, {formatCoordinate(geofence.longitude)}) with
          ±{SIMULATED_ACCURACY_METERS} m accuracy. The outside reading is
          {' '}
          {geofence.radiusMeters * OUTSIDE_RADIUS_MULTIPLIER} m north of that centre. A re-entry
          straight after an exit still lands inside the policy cooldown window, so it re-confirms
          the entry without sending a second notification.
        </p>
      </div>
    </section>
  )
}
