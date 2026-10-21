/**
 * Visitor identity.
 *
 * The backend only needs an opaque value to correlate the entries recorded by one browser
 * session, so this module deliberately collects nothing else: no name, no email, no device
 * fingerprint, no persistent cookie. The id lives in `sessionStorage`, so closing the tab
 * starts a new visitor session.
 */

/** Key under which the session id is kept for the lifetime of the browser tab. */
export const SESSION_STORAGE_KEY = 'geofence.visitorSessionId'

/**
 * Creates an opaque random identifier (UUID v4 when the browser can produce one).
 *
 * `crypto.randomUUID` is only available in a secure context (HTTPS or localhost), so the
 * `getRandomValues` path keeps the app usable on a plain-HTTP origin when geolocation is
 * also unavailable there.
 */
export function createOpaqueId(): string {
  const cryptoApi: Crypto | undefined = globalThis.crypto

  if (cryptoApi !== undefined && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID()
  }

  if (cryptoApi !== undefined && typeof cryptoApi.getRandomValues === 'function') {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16))
    // RFC 4122 version 4 / variant 10xx.
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80

    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')

    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20, 32),
    ].join('-')
  }

  throw new Error('This browser cannot generate a random identifier.')
}

function readStoredSessionId(): string | null {
  try {
    return globalThis.sessionStorage?.getItem(SESSION_STORAGE_KEY) ?? null
  } catch {
    // Storage can be blocked (private mode, hardened privacy settings). A per-load id is an
    // acceptable degradation: the backend still receives a well-formed session id.
    return null
  }
}

function writeStoredSessionId(sessionId: string): void {
  try {
    globalThis.sessionStorage?.setItem(SESSION_STORAGE_KEY, sessionId)
  } catch {
    // Ignored on purpose; see `readStoredSessionId`.
  }
}

/** Fallback holder used when `sessionStorage` is unavailable. */
let inMemorySessionId: string | null = null

/** Returns the visitor session id, creating and storing one on first use. */
export function getVisitorSessionId(): string {
  const stored = readStoredSessionId()

  if (stored !== null && stored.length > 0) {
    inMemorySessionId = stored
    return stored
  }

  if (inMemorySessionId === null) {
    inMemorySessionId = createOpaqueId()
  }

  writeStoredSessionId(inMemorySessionId)

  return inMemorySessionId
}

/** Clears the session id. Used by tests to prove that a new tab gets a new identity. */
export function resetVisitorSessionId(): void {
  inMemorySessionId = null

  try {
    globalThis.sessionStorage?.removeItem(SESSION_STORAGE_KEY)
  } catch {
    // Ignored on purpose.
  }
}
