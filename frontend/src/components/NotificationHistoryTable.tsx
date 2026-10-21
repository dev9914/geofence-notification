import { MapPin } from 'lucide-react'
import type { NotificationPage } from '../api/types'
import { formatCoordinate, formatIsoDateTime, formatMeters } from '../utils/format'

export interface NotificationHistoryTableProps {
  history: NotificationPage
}

/**
 * Recent notification history (`GET /api/v1/notifications`).
 *
 * Every value is the one the backend reported; nothing is recomputed here. Coordinates are
 * rendered through the shared formatter, which degrades to an em dash instead of printing
 * `NaN`, so a missing or unusable numeric field cannot break the table.
 */
export default function NotificationHistoryTable({ history }: NotificationHistoryTableProps) {
  const { notifications, pagination } = history

  return (
    <section className="panel" aria-labelledby="history-heading">
      <header className="panel__header">
        <MapPin size={18} aria-hidden="true" />
        <h2 id="history-heading">Recent notification history</h2>
      </header>

      {notifications.length === 0 ? (
        <div className="empty">
          <MapPin size={22} aria-hidden="true" />
          <strong>No notifications recorded yet</strong>
          <p>
            Open the visitor page, start tracking and enter the geofence. A confirmed entry
            appears here once the API accepts it.
          </p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <caption className="table__caption">
              The {notifications.length} most recent notification events, newest first.
            </caption>
            <thead>
              <tr>
                <th scope="col">Observed</th>
                <th scope="col">Geofence</th>
                <th scope="col">Distance</th>
                <th scope="col">Session</th>
                <th scope="col">Reported position</th>
              </tr>
            </thead>
            <tbody>
              {notifications.map((event) => (
                <tr key={event.eventId}>
                  <td>
                    <span>{formatIsoDateTime(event.occurredAt)}</span>
                    <span className="table__sub">
                      recorded {formatIsoDateTime(event.createdAt)}
                    </span>
                  </td>
                  <td>
                    <code>{event.geofenceId}</code>
                  </td>
                  <td>
                    <span>{formatMeters(event.distanceMeters)}</span>
                    <span className="table__sub">
                      accuracy ±{formatMeters(event.accuracyMeters)}
                    </span>
                  </td>
                  <td>
                    <code>{event.sessionId}</code>
                  </td>
                  <td>
                    <span>
                      {formatCoordinate(event.userLatitude)}, {formatCoordinate(event.userLongitude)}
                    </span>
                    <span className="table__sub">
                      target {formatCoordinate(event.targetLatitude)},{' '}
                      {formatCoordinate(event.targetLongitude)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="panel__note">
        Showing {pagination.count} of {pagination.total.toLocaleString()} recorded events
        {pagination.hasMore
          ? ` · older events exist on the server (requested the newest ${pagination.limit}).`
          : ' · this is the full history.'}
      </p>
    </section>
  )
}
