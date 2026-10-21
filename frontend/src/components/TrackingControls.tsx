import { Play, Square } from 'lucide-react'

export interface TrackingControlsProps {
  isTracking: boolean
  /** True when the geofence configuration is loaded and enabled. */
  canTrack: boolean
  onStart: () => void
  onStop: () => void
}

/** Start/Stop controls for the browser GPS watcher. */
export default function TrackingControls({
  isTracking,
  canTrack,
  onStart,
  onStop,
}: TrackingControlsProps) {
  return (
    <div className="controls">
      <button
        type="button"
        className="button button--primary"
        onClick={onStart}
        disabled={isTracking || !canTrack}
      >
        <Play size={18} aria-hidden="true" />
        Start tracking
      </button>

      <button type="button" className="button" onClick={onStop} disabled={!isTracking}>
        <Square size={18} aria-hidden="true" />
        Stop tracking
      </button>

      <p className="controls__help">
        Tracking uses your browser&apos;s real GPS position. It needs location permission and a
        secure context (HTTPS or localhost), and it stops when you press Stop tracking, leave this
        page, or close the tab.
      </p>
    </div>
  )
}
