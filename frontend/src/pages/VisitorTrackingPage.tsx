import { CircleAlert, FlaskConical, LoaderCircle, Lock, RefreshCw } from 'lucide-react'
import AccuracyNotice from '../components/AccuracyNotice'
import GeofenceInfoPanel from '../components/GeofenceInfoPanel'
import NotificationPanel from '../components/NotificationPanel'
import StatusIndicator from '../components/StatusIndicator'
import TelemetryPanel from '../components/TelemetryPanel'
import TrackingControls from '../components/TrackingControls'
import DevGpsTestPanel from '../dev/DevGpsTestPanel'
import { describeVisitorStatus } from '../geofence/status'
import { useGeofenceConfig } from '../hooks/useGeofenceConfig'
import { isSecureContextAvailable } from '../hooks/useGeolocation'
import { useVisitorTracking } from '../hooks/useVisitorTracking'

/**
 * Visitor tracking page.
 *
 * The geofence configuration is fetched from the backend before anything else; until it is
 * available the page does not offer tracking, because there would be no radius to measure
 * the visitor's position against.
 */
export default function VisitorTrackingPage() {
  const config = useGeofenceConfig()
  const tracking = useVisitorTracking(config.geofence)

  if (config.status === 'loading') {
    return (
      <div className="page">
        <section className="panel panel--centered" role="status">
          <LoaderCircle size={22} aria-hidden="true" className="record__icon" />
          <h1>Loading geofence configuration…</h1>
          <p>Fetching the canonical target and radius from the geofence API.</p>
        </section>
      </div>
    )
  }

  if (config.geofence === null) {
    return (
      <div className="page">
        <section className="panel panel--centered" role="alert">
          <CircleAlert size={22} aria-hidden="true" />
          <h1>Geofence configuration unavailable</h1>
          <p>{config.failure?.message ?? 'The geofence configuration could not be loaded.'}</p>
          {config.failure?.hint !== null && config.failure?.hint !== undefined && (
            <p className="panel__note">{config.failure.hint}</p>
          )}
          <div className="record__actions">
            <button type="button" className="button button--primary" onClick={config.reload}>
              <RefreshCw size={16} aria-hidden="true" />
              Retry
            </button>
          </div>
          <p className="panel__note">
            Tracking stays unavailable until the configuration loads, because the frontend does not
            keep its own copy of the geofence coordinates or radius.
          </p>
        </section>
      </div>
    )
  }

  const geofence = config.geofence

  // A reading applied from the development test mode is shown instead of the last browser fix,
  // and counts as "having a fix", so the geofence classification stays visible.
  const isSimulated = tracking.simulatedFix !== null
  const activeFix = tracking.simulatedFix ?? tracking.geolocation.fix

  const statusView = describeVisitorStatus({
    isTracking: tracking.geolocation.isTracking || isSimulated,
    geolocationStatus: isSimulated ? 'tracking' : tracking.geolocation.status,
    machine: tracking.machine,
    hasFix: activeFix !== null,
  })

  return (
    <div className="page">
      <div className="page__intro">
        <h1>Visitor tracking</h1>
        <p>
          Start tracking to stream your real GPS position from the browser and have every confirmed
          entry recorded by the geofence API.
        </p>
      </div>

      <StatusIndicator view={statusView} />

      {!isSecureContextAvailable() && (
        <p className="notice notice--warning" role="status">
          <Lock size={16} aria-hidden="true" />
          <span>
            This page is not running in a secure context. Browsers only grant location access over
            HTTPS or on localhost, so tracking may fail until you serve the app securely.
          </span>
        </p>
      )}

      {tracking.isDisabled && (
        <p className="notice notice--warning" role="status">
          <CircleAlert size={16} aria-hidden="true" />
          <span>
            The backend reports this geofence as disabled, so tracking is unavailable and no
            notification can be recorded.
          </span>
        </p>
      )}

      <TrackingControls
        isTracking={tracking.geolocation.isTracking}
        canTrack={tracking.canTrack}
        onStart={tracking.start}
        onStop={tracking.stop}
      />

      {/*
        Development-only test mode. `import.meta.env.DEV` is statically replaced with `false`
        in a production build, so this whole branch — the controls and the test-reading marker
        — is dropped from the bundle and the mode cannot be enabled in production.
      */}
      {import.meta.env.DEV && (
        <>
          <DevGpsTestPanel geofence={geofence} onApplyFix={tracking.applyFix} />

          {isSimulated && (
            <p className="notice notice--warning" role="note">
              <FlaskConical size={16} aria-hidden="true" />
              <span>
                Simulated reading from the development GPS test mode — not a real GPS fix. The
                backend still validates and stores it exactly like a real entry, because the API
                has no field to mark its origin.
              </span>
            </p>
          )}
        </>
      )}

      <AccuracyNotice
        accuracyMeters={tracking.machine.accuracyMeters}
        thresholdMeters={geofence.policy.accuracyThresholdMeters}
      />

      <NotificationPanel recording={tracking.recording} />

      <div className="grid">
        <TelemetryPanel
          fix={activeFix}
          machine={tracking.machine}
          evaluation={tracking.evaluation}
          radiusMeters={geofence.radiusMeters}
        />
        <GeofenceInfoPanel geofence={geofence} />
      </div>
    </div>
  )
}
