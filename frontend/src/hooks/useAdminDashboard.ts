import { useCallback, useEffect, useState } from 'react'
import { fetchGeofences } from '../api/geofences'
import { describeDashboardFailure, type FailureDescription } from '../api/failures'
import { fetchNotificationHistory, fetchNotificationStats } from '../api/notifications'
import type { Geofence, NotificationPage, NotificationStats } from '../api/types'

/**
 * Loads everything the admin dashboard shows, through the existing typed API functions.
 *
 * The three read endpoints are fetched in parallel and treated as one unit: the dashboard has
 * no meaningful partial view, so a failure on any of them surfaces a single retryable error.
 * The backend exposes no write endpoints for geofence settings, so nothing here mutates state.
 */

/** How many history rows to request. The backend bounds `limit` to 100 and defaults to 20. */
export const HISTORY_LIMIT = 20

export interface DashboardData {
  /** The canonical geofence from `GET /api/v1/geofences`. */
  geofence: Geofence
  /** Database-derived totals from `GET /api/v1/notifications/stats`. */
  stats: NotificationStats
  /** The most recent page of history from `GET /api/v1/notifications`. */
  history: NotificationPage
}

export interface AdminDashboardResult {
  data: DashboardData | null
  failure: FailureDescription | null
  /** `true` while a request is in flight, including a manual refresh. */
  isLoading: boolean
  /** Local epoch milliseconds of the last successful load, or `null` before the first one. */
  lastRefreshedAt: number | null
  refresh: () => void
}

const NO_GEOFENCE_FAILURE: FailureDescription = {
  code: 'NO_GEOFENCE',
  message: 'The geofence API returned no geofence configuration to display.',
  hint: 'Check the geofence registry on the backend, then retry.',
}

export function useAdminDashboard(): AdminDashboardResult {
  const [data, setData] = useState<DashboardData | null>(null)
  const [failure, setFailure] = useState<FailureDescription | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    const signal = controller.signal

    Promise.all([
      fetchGeofences({ signal }),
      fetchNotificationStats({ signal }),
      fetchNotificationHistory({ limit: HISTORY_LIMIT, signal }),
    ])
      .then(([geofences, stats, history]) => {
        if (!active) {
          return
        }

        const geofence = geofences[0]

        if (geofence === undefined) {
          setIsLoading(false)
          setFailure(NO_GEOFENCE_FAILURE)
          return
        }

        setData({ geofence, stats, history })
        setFailure(null)
        setIsLoading(false)
        setLastRefreshedAt(Date.now())
      })
      .catch((error: unknown) => {
        if (!active) {
          return
        }

        // Any data already on screen is kept: it is still the last thing the API reported.
        setIsLoading(false)
        setFailure(describeDashboardFailure(error))
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [attempt])

  const refresh = useCallback(() => {
    // Back to the loading state, but the previous load stays on screen until the new one
    // answers, so a refresh never blanks the dashboard.
    setIsLoading(true)
    setFailure(null)
    setAttempt((value) => value + 1)
  }, [])

  return { data, failure, isLoading, lastRefreshedAt, refresh }
}
