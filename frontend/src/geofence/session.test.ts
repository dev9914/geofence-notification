import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SESSION_STORAGE_KEY,
  createOpaqueId,
  getVisitorSessionId,
  resetVisitorSessionId,
} from './session'

/** UUID v4 shape: the version and variant nibbles must be set. */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('visitor session identity', () => {
  beforeEach(() => {
    resetVisitorSessionId()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    resetVisitorSessionId()
  })

  it('creates opaque identifiers in UUID form', () => {
    const first = createOpaqueId()
    const second = createOpaqueId()

    expect(first).toMatch(UUID_V4)
    expect(second).toMatch(UUID_V4)
    expect(first).not.toBe(second)
  })

  it('keeps one stable session id for the browser tab', () => {
    const created = getVisitorSessionId()

    expect(created).toMatch(UUID_V4)
    expect(getVisitorSessionId()).toBe(created)
    expect(sessionStorage.getItem(SESSION_STORAGE_KEY)).toBe(created)
  })

  it('starts a new session after the stored id is cleared', () => {
    const first = getVisitorSessionId()

    resetVisitorSessionId()

    expect(getVisitorSessionId()).not.toBe(first)
  })

  it('still works when session storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage blocked')
    })

    const id = getVisitorSessionId()

    expect(id).toMatch(UUID_V4)
    // The in-memory fallback keeps the identity stable for the rest of the page's life.
    expect(getVisitorSessionId()).toBe(id)
  })
})
