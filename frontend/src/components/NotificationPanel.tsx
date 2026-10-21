import { CircleAlert, LoaderCircle, RefreshCw, ShieldCheck, X } from 'lucide-react'
import type { NotificationRecording } from '../hooks/useNotificationRecorder'
import { formatIsoClockTime, formatMeters, formatShortId } from '../utils/format'

export interface NotificationPanelProps {
  recording: NotificationRecording
}

/**
 * Entry-notification panel.
 *
 * The success state is only reachable after the backend has answered, so the panel never
 * claims a record that was not persisted.
 */
export default function NotificationPanel({ recording }: NotificationPanelProps) {
  if (recording.status === 'idle') {
    return null
  }

  if (recording.status === 'pending') {
    return (
      <section className="record record--pending" role="status">
        <LoaderCircle size={20} aria-hidden="true" className="record__icon" />
        <div className="record__body">
          <strong>Recording entry…</strong>
          <p>Waiting for the geofence API to accept this notification.</p>
        </div>
      </section>
    )
  }

  if (recording.status === 'failed' && recording.failure !== null) {
    return (
      <section className="record record--failed" role="alert">
        <CircleAlert size={20} aria-hidden="true" className="record__icon" />
        <div className="record__body">
          <strong>Notification could not be saved</strong>
          <p>{recording.failure.message}</p>
          {recording.failure.hint !== null && <p className="record__hint">{recording.failure.hint}</p>}
          <div className="record__actions">
            {recording.canRetry && (
              <button type="button" className="button button--small" onClick={recording.retry}>
                <RefreshCw size={14} aria-hidden="true" />
                Retry
              </button>
            )}
            <button type="button" className="button button--small" onClick={recording.dismiss}>
              <X size={14} aria-hidden="true" />
              Dismiss
            </button>
          </div>
        </div>
      </section>
    )
  }

  if (recording.entry === null) {
    return null
  }

  return (
    <section className="record record--recorded" role="status">
      <ShieldCheck size={20} aria-hidden="true" className="record__icon" />
      <div className="record__body">
        <strong>
          {recording.entry.duplicate
            ? 'Entry already recorded by the backend'
            : 'Entry recorded by the backend'}
        </strong>
        <p>
          Notification {formatShortId(recording.entry.eventId)} · observed{' '}
          {formatIsoClockTime(recording.entry.occurredAt)} · the backend measured{' '}
          {formatMeters(recording.entry.distanceMeters)} from the geofence centre.
        </p>
        <div className="record__actions">
          <button type="button" className="button button--small" onClick={recording.dismiss}>
            <X size={14} aria-hidden="true" />
            Dismiss
          </button>
        </div>
      </div>
    </section>
  )
}
