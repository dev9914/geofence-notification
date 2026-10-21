import { CircleAlert, LoaderCircle, RefreshCw, ShieldCheck } from 'lucide-react'
import GeofenceInfoPanel from '../components/GeofenceInfoPanel'
import NotificationHistoryTable from '../components/NotificationHistoryTable'
import SummaryCards from '../components/SummaryCards'
import { useAdminDashboard } from '../hooks/useAdminDashboard'
import { formatClockTime } from '../utils/format'

/** Placeholder rows shown while the first request is in flight. */
function DashboardSkeleton() {
  return (
    <section className="panel" role="status" aria-label="Loading dashboard">
      <LoaderCircle size={22} aria-hidden="true" className="record__icon" />
      <h2>Loading dashboard…</h2>
      <p>Fetching the geofence configuration, the recorded totals and the recent history.</p>
      <div className="skeleton-stack" aria-hidden="true">
        <span className="skeleton skeleton--metric" />
        <span className="skeleton skeleton--metric" />
        <span className="skeleton skeleton--row" />
        <span className="skeleton skeleton--row" />
        <span className="skeleton skeleton--row" />
      </div>
    </section>
  )
}

/**
 * Admin dashboard.
 *
 * Reads the three existing endpoints through the typed API client: the geofence
 * configuration, the database-derived summary and the paginated notification history. The
 * backend publishes no write endpoints for geofence settings, so the page is deliberately
 * read-only and offers no controls that would imply it could change them.
 */
export default function AdminDashboardPage() {
  const { data, failure, isLoading, lastRefreshedAt, refresh } = useAdminDashboard()

  return (
    <div className="page">
      <div className="page__toolbar">
        <div className="page__intro">
          <h1>Admin dashboard</h1>
          <p>
            Persisted notification history and the geofence the backend currently serves, read
            directly from the geofence API.
          </p>
        </div>

        <div className="refresh">
          <button
            type="button"
            className="button button--small"
            onClick={refresh}
            disabled={isLoading}
          >
            <RefreshCw size={14} aria-hidden="true" />
            {isLoading ? 'Refreshing…' : 'Refresh'}
          </button>
          <span className="refresh__stamp">Last refreshed: {formatClockTime(lastRefreshedAt)}</span>
        </div>
      </div>

      <p className="notice">
        <ShieldCheck size={16} aria-hidden="true" />
        <span>
          This dashboard is read-only. The API exposes the geofence configuration and the
          notification history as read-only resources, so there are no controls here to change the
          radius, the policy or the enabled state.
        </span>
      </p>

      {data !== null ? (
        <>
          {failure !== null && (
            <p className="notice notice--warning" role="alert">
              <CircleAlert size={16} aria-hidden="true" />
              <span>
                The latest refresh failed, so the figures below are from the previous successful
                load. {failure.message}
              </span>
            </p>
          )}

          <SummaryCards stats={data.stats} />
          <GeofenceInfoPanel geofence={data.geofence} />
          <NotificationHistoryTable history={data.history} />
        </>
      ) : failure !== null ? (
        <section className="panel panel--centered" role="alert">
          <CircleAlert size={22} aria-hidden="true" />
          <h2>Dashboard data unavailable</h2>
          <p>{failure.message}</p>
          {failure.hint !== null && <p className="panel__note">{failure.hint}</p>}
          <div className="record__actions">
            <button type="button" className="button button--primary" onClick={refresh}>
              <RefreshCw size={16} aria-hidden="true" />
              Retry
            </button>
          </div>
          <p className="panel__note">
            No figures are shown until the API answers, because the dashboard never displays
            example or cached totals.
          </p>
        </section>
      ) : (
        <DashboardSkeleton />
      )}
    </div>
  )
}
