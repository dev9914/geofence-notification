import { Info, Target } from 'lucide-react'
import type { Geofence } from '../api/types'
import { formatCoordinate, formatMeters, formatSeconds } from '../utils/format'

export interface GeofenceInfoPanelProps {
  geofence: Geofence
}

/** The configured target and radius, exactly as the backend reports them. */
export default function GeofenceInfoPanel({ geofence }: GeofenceInfoPanelProps) {
  return (
    <section className="panel" aria-labelledby="geofence-heading">
      <header className="panel__header">
        <Target size={18} aria-hidden="true" />
        <h2 id="geofence-heading">Configured geofence</h2>
      </header>

      <dl className="metrics">
        <div className="metric">
          <dt>Name</dt>
          <dd>{geofence.name}</dd>
        </div>

        <div className="metric">
          <dt>Id</dt>
          <dd>
            <code>{geofence.id}</code>
          </dd>
        </div>

        <div className="metric">
          <dt>Target latitude</dt>
          <dd>{formatCoordinate(geofence.latitude)}</dd>
        </div>

        <div className="metric">
          <dt>Target longitude</dt>
          <dd>{formatCoordinate(geofence.longitude)}</dd>
        </div>

        <div className="metric">
          <dt>Radius</dt>
          <dd>{formatMeters(geofence.radiusMeters, 0)}</dd>
        </div>

        <div className="metric">
          <dt>Status</dt>
          <dd>{geofence.enabled ? 'Enabled' : 'Disabled'}</dd>
        </div>

        <div className="metric">
          <dt>Notification cooldown</dt>
          <dd>{formatSeconds(geofence.policy.cooldownMs)}</dd>
        </div>

        <div className="metric">
          <dt>Accuracy threshold</dt>
          <dd>{formatMeters(geofence.policy.accuracyThresholdMeters, 0)}</dd>
        </div>
      </dl>

      <p className="panel__note">
        <Info size={14} aria-hidden="true" />
        Loaded from the geofence API. A reading exactly on the radius counts as inside, and a
        notification is sent only on a confirmed entry, at most once per cooldown window.
      </p>
    </section>
  )
}
