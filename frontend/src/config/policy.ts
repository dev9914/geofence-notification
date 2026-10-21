/**
 * Client-side copies of two reading-age rules that the backend enforces but does not
 * expose through `GET /api/v1/geofences`.
 *
 * They exist so the browser can avoid sending a reading it already knows the backend will
 * reject (`STALE_READING` / `FUTURE_READING`). The backend remains authoritative and
 * re-validates every request; these numbers must stay in step with
 * `backend/src/services/notificationService.ts`.
 */

/** A reading older than this is stale (backend `MAX_READING_AGE_MS`). */
export const MAX_READING_AGE_MS = 30_000

/** Tolerated clock skew for a reading slightly ahead of the server. */
export const MAX_FUTURE_SKEW_MS = 5_000
