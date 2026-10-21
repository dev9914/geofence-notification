import { API_BASE_URL, REQUEST_TIMEOUT_MS } from '../config/env'
import { isApiErrorEnvelope } from './contract'

/**
 * Thin JSON client for the geofence API.
 *
 * Every failure becomes an `ApiError` carrying the backend's error code when there is one, so
 * callers can react to `DATABASE_UNAVAILABLE` or `VALIDATION_ERROR` without inspecting
 * response objects, and never see a raw exception, stack trace or response body.
 */
export class ApiError extends Error {
  /** Backend error code, or a client-side code such as `NETWORK_ERROR`. */
  readonly code: string
  /** HTTP status, or `null` when the request never produced a response. */
  readonly status: number | null

  constructor(message: string, code: string, status: number | null) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

export interface ApiRequestOptions {
  method?: 'GET' | 'POST'
  body?: unknown
  signal?: AbortSignal
}

async function readJsonBody(response: Response): Promise<unknown> {
  const text = await response.text()

  if (text.trim().length === 0) {
    return undefined
  }

  try {
    return JSON.parse(text)
  } catch {
    // A non-JSON body (an HTML error page from a proxy, for example) is not a contract
    // violation worth surfacing verbatim.
    return undefined
  }
}

function errorFromResponse(status: number, payload: unknown): ApiError {
  if (isApiErrorEnvelope(payload)) {
    return new ApiError(payload.error.message, payload.error.code, status)
  }

  return new ApiError(`The geofence API answered with HTTP ${status}.`, 'UNEXPECTED_STATUS', status)
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'AbortError'
  )
}

/**
 * Performs a request against the API and hands the parsed JSON body to `parse`.
 *
 * `parse` is required so every response is validated before it reaches the application.
 */
export async function apiRequest<T>(
  path: string,
  parse: (body: unknown) => T,
  options: ApiRequestOptions = {},
): Promise<T> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const hasBody = options.body !== undefined

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: options.method ?? 'GET',
      headers: hasBody ? { 'Content-Type': 'application/json' } : undefined,
      body: hasBody ? JSON.stringify(options.body) : undefined,
      signal: options.signal ?? controller.signal,
    })

    const payload = await readJsonBody(response)

    if (!response.ok) {
      throw errorFromResponse(response.status, payload)
    }

    return parse(payload)
  } catch (error) {
    if (error instanceof ApiError) {
      throw error
    }

    if (isAbortError(error)) {
      throw new ApiError('The request to the geofence API timed out.', 'REQUEST_TIMEOUT', null)
    }

    throw new ApiError(
      `Could not reach the geofence API at ${API_BASE_URL}.`,
      'NETWORK_ERROR',
      null,
    )
  } finally {
    clearTimeout(timeoutId)
  }
}
