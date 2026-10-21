import { Clock, Crosshair, MapPin, Radio, Target } from 'lucide-react'
import type { GeolocationFix } from '../hooks/useGeolocation'
import {
  NOTIFICATION_REASON_TEXT,
  type ReadingEvaluation,
  type VisitorMachineState,
} from '../geofence/machine'
import { formatClockTime, formatCoordinate, formatMeters } from '../utils/format'

export interface TelemetryPanelProps {
  fix: GeolocationFix | null
  machine: VisitorMachineState
  evaluation: ReadingEvaluation | null
  /** Angular radius reported by the backend, used as the comparison label. */
  radiusMeters: number
}

/** Current position, accuracy and measured distance to the geofence centre. */
export default function TelemetryPanel({
  fix,
  machine,
  evaluation,
  radiusMeters,
}: TelemetryPanelProps) {
  const isUncertain = machine.status === 'uncertain'

  return (
    <section className="panel" aria-labelledby="telemetry-heading">
      <header className="panel__header">
        <Crosshair size={18} aria-hidden="true" />
        <h2 id="telemetry-heading">Current reading</h2>
      </header>

      <dl className="metrics">
        <div className="metric">
          <dt>
            <MapPin size={14} aria-hidden="true" /> Latitude
          </dt>
          <dd>{formatCoordinate(fix?.latitude ?? null)}</dd>
        </div>

        <div className="metric">
          <dt>
            <MapPin size={14} aria-hidden="true" /> Longitude
          </dt>
          <dd>{formatCoordinate(fix?.longitude ?? null)}</dd>
        </div>

        <div className="metric">
          <dt>
            <Radio size={14} aria-hidden="true" /> GPS accuracy
          </dt>
          <dd>{fix === null ? '—' : `±${formatMeters(fix.accuracyMeters)}`}</dd>
        </div>

        <div className="metric">
          <dt>
            <Target size={14} aria-hidden="true" /> Distance to centre
          </dt>
          <dd>
            {formatMeters(machine.distanceMeters)}
            <span className="metric__note">
              {isUncertain ? ' (approximate — accuracy too low)' : ` (radius ${formatMeters(radiusMeters)})`}
            </span>
          </dd>
        </div>

        <div className="metric">
          <dt>
            <Clock size={14} aria-hidden="true" /> Observed at
          </dt>
          <dd>{formatClockTime(fix?.occurredAt ?? null)}</dd>
        </div>
      </dl>

      {evaluation !== null && (
        <p className="panel__note" role="note">
          {evaluation.rejection !== null
            ? `Reading discarded (${evaluation.rejection.replace(/-/g, ' ')}), so it did not change the geofence status.`
            : NOTIFICATION_REASON_TEXT[evaluation.notification.reason]}
        </p>
      )}
    </section>
  )
}
