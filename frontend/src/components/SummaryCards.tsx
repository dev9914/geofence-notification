import { Clock, Radio } from 'lucide-react'
import type { NotificationStats } from '../api/types'
import { formatIsoDateTime } from '../utils/format'

export interface SummaryCardsProps {
  stats: NotificationStats
}

/**
 * Database-derived summary (`GET /api/v1/notifications/stats`).
 *
 * `latestNotificationAt` is nullable: the backend returns `null` until the first event is
 * stored, so that case is rendered as an explicit empty state rather than an invalid date.
 */
export default function SummaryCards({ stats }: SummaryCardsProps) {
  const hasLatest = stats.latestNotificationAt !== null

  return (
    <section className="cards" aria-label="Summary">
      <article className="card">
        <span className="card__label">
          <Radio size={14} aria-hidden="true" />
          Recorded notifications
        </span>
        <strong className="card__value">{stats.totalEvents.toLocaleString()}</strong>
        <span className="card__note">Events stored by the API in the notification collection.</span>
      </article>

      <article className="card">
        <span className="card__label">
          <Clock size={14} aria-hidden="true" />
          Latest notification
        </span>
        <strong className="card__value card__value--time">
          {hasLatest ? formatIsoDateTime(stats.latestNotificationAt) : 'No notifications yet'}
        </strong>
        <span className="card__note">
          {hasLatest
            ? 'Observation time of the most recent recorded entry.'
            : 'Nothing has been recorded yet. Start tracking to create the first event.'}
        </span>
      </article>
    </section>
  )
}
