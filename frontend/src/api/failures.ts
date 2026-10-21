import { ApiError } from './client'

/** A failure described in terms a visitor can act on. */
export interface FailureDescription {
  code: string
  message: string
  hint: string | null
}

/**
 * Turns any thrown value from the API layer into visitor-facing copy.
 *
 * A message here is never a success message: every branch states that the notification was
 * not saved, because the app must not claim persistence it did not get.
 */
export function describeApiFailure(error: unknown): FailureDescription {
  if (!(error instanceof ApiError)) {
    return {
      code: 'UNKNOWN',
      message: 'The notification could not be saved because of an unexpected error.',
      hint: 'Try again. If it keeps failing, check the browser console and the API logs.',
    }
  }

  switch (error.code) {
    case 'NETWORK_ERROR':
      return {
        code: error.code,
        message: 'The notification was not saved: the geofence API could not be reached.',
        hint: 'Check that the backend is running and that VITE_API_BASE_URL points at it.',
      }
    case 'REQUEST_TIMEOUT':
      return {
        code: error.code,
        message: 'The notification was not saved: the geofence API did not answer in time.',
        hint: 'Check your connection, then retry.',
      }
    case 'DATABASE_UNAVAILABLE':
      return {
        code: error.code,
        message:
          'The notification was not saved: the server could not reach notification storage.',
        hint: 'The server is running but its database is unavailable. Retry once it recovers.',
      }
    case 'DUPLICATE_EVENT':
      return {
        code: error.code,
        message: 'This entry was already recorded by the server.',
        hint: null,
      }
    case 'STALE_READING':
      return {
        code: error.code,
        message: 'The notification was not saved: the reading was too old when it arrived.',
        hint: 'Keep tracking to record the next confirmed entry.',
      }
    case 'FUTURE_READING':
      return {
        code: error.code,
        message: 'The notification was not saved: the device clock is ahead of the server.',
        hint: 'Check the device date and time settings.',
      }
    case 'OUTSIDE_GEOFENCE':
      return {
        code: error.code,
        message: 'The notification was not saved: the server measured the position outside the radius.',
        hint: 'GPS drift can move a reading outside the boundary. Keep tracking.',
      }
    case 'ACCURACY_TOO_LOW':
      return {
        code: error.code,
        message: 'The notification was not saved: the GPS accuracy was too poor for the server.',
        hint: 'Move to a clearer view of the sky and keep tracking.',
      }
    case 'GEOFENCE_NOT_FOUND':
    case 'GEOFENCE_DISABLED':
      return {
        code: error.code,
        message: 'The notification was not saved: the geofence is no longer available.',
        hint: 'Reload the page to fetch the current geofence configuration.',
      }
    case 'VALIDATION_ERROR':
    case 'INVALID_RESPONSE':
      return {
        code: error.code,
        message: `The notification was not saved: the server rejected the request (${error.message}).`,
        hint: 'This usually means the frontend and backend contracts have diverged.',
      }
    default:
      return {
        code: error.code,
        message: `The notification was not saved: ${error.message}`,
        hint: 'Retry. If it keeps failing, check the API logs.',
      }
  }
}

/**
 * Turns any thrown value from the API layer into copy for the geofence-configuration load.
 *
 * Kept separate from `describeApiFailure` because the subject is different: nothing has been
 * persisted at this point, so these messages talk about loading, not about saving.
 */
export function describeConfigFailure(error: unknown): FailureDescription {
  if (!(error instanceof ApiError)) {
    return {
      code: 'UNKNOWN',
      message: 'The geofence configuration could not be loaded because of an unexpected error.',
      hint: 'Retry. If it keeps failing, check the browser console and the API logs.',
    }
  }

  switch (error.code) {
    case 'NETWORK_ERROR':
      return {
        code: error.code,
        message: 'The geofence API could not be reached, so the geofence configuration is unknown.',
        hint: 'Check that the backend is running and that VITE_API_BASE_URL points at it, then retry.',
      }
    case 'REQUEST_TIMEOUT':
      return {
        code: error.code,
        message: 'The geofence API did not answer in time, so the configuration could not be loaded.',
        hint: 'Check your connection, then retry.',
      }
    case 'DATABASE_UNAVAILABLE':
      return {
        code: error.code,
        message: 'The server cannot reach its database, so the geofence configuration is unavailable.',
        hint: 'The server is running but its database is unavailable. Retry once it recovers.',
      }
    case 'INVALID_RESPONSE':
      return {
        code: error.code,
        message: `The geofence API returned an unexpected response (${error.message}).`,
        hint: 'This usually means the frontend and backend contracts have diverged.',
      }
    default:
      return {
        code: error.code,
        message: `The geofence configuration could not be loaded: ${error.message}`,
        hint: 'Retry. If it keeps failing, check the API logs.',
      }
  }
}

/**
 * Turns any thrown value from the API layer into copy for the admin dashboard.
 *
 * The dashboard reads three endpoints, so the wording stays about loading and never claims a
 * particular figure was retrieved.
 */
export function describeDashboardFailure(error: unknown): FailureDescription {
  if (!(error instanceof ApiError)) {
    return {
      code: 'UNKNOWN',
      message: 'The dashboard data could not be loaded because of an unexpected error.',
      hint: 'Retry. If it keeps failing, check the browser console and the API logs.',
    }
  }

  switch (error.code) {
    case 'NETWORK_ERROR':
      return {
        code: error.code,
        message: 'The dashboard data could not be loaded: the geofence API could not be reached.',
        hint: 'Check that the backend is running and that VITE_API_BASE_URL points at it, then retry.',
      }
    case 'REQUEST_TIMEOUT':
      return {
        code: error.code,
        message: 'The dashboard data could not be loaded: the geofence API did not answer in time.',
        hint: 'Check your connection, then retry.',
      }
    case 'DATABASE_UNAVAILABLE':
      return {
        code: error.code,
        message: 'The dashboard data could not be loaded: the server cannot reach notification storage.',
        hint: 'The server is running but its database is unavailable. Retry once it recovers.',
      }
    case 'INVALID_RESPONSE':
      return {
        code: error.code,
        message: `The geofence API returned an unexpected response (${error.message}).`,
        hint: 'This usually means the frontend and backend contracts have diverged.',
      }
    default:
      return {
        code: error.code,
        message: `The dashboard data could not be loaded: ${error.message}`,
        hint: 'Retry. If it keeps failing, check the API logs.',
      }
  }
}
