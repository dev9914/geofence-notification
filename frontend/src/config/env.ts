/**
 * Frontend runtime configuration.
 *
 * `VITE_API_BASE_URL` points at the backend API. It defaults to the local development
 * server (`http://localhost:3000`, the backend's default `PORT`), and the backend's default
 * CORS origin is `http://localhost:5173`, which is Vite's default dev port.
 */

export const DEFAULT_API_BASE_URL = 'http://localhost:3000'

/** Versioned API prefix implemented by the backend. */
export const API_V1_PREFIX = '/api/v1'

/** Requests that have not answered within this window are abandoned. */
export const REQUEST_TIMEOUT_MS = 10_000

function normaliseBaseUrl(value: string | undefined): string {
  const trimmed = (value ?? '').trim()

  if (trimmed.length === 0) {
    return DEFAULT_API_BASE_URL
  }

  return trimmed.replace(/\/+$/, '')
}

export const API_BASE_URL = normaliseBaseUrl(import.meta.env.VITE_API_BASE_URL)
