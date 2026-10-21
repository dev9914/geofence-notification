/** Small display helpers. Formatting only; no geofence logic lives here. */

/** Distance or accuracy in metres, always with a unit. */
export function formatMeters(value: number | null, fractionDigits = 1): string {
  if (value === null || !Number.isFinite(value)) {
    return '—'
  }

  return `${value.toFixed(fractionDigits)} m`
}

/** Latitude/longitude with the precision a 30 m radius needs. */
export function formatCoordinate(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return '—'
  }

  return value.toFixed(6)
}

/** Epoch milliseconds as a local clock time. */
export function formatClockTime(epochMs: number | null): string {
  if (epochMs === null || !Number.isFinite(epochMs)) {
    return '—'
  }

  return new Date(epochMs).toLocaleTimeString()
}

/** An ISO-8601 instant from the API as a local clock time. */
export function formatIsoClockTime(iso: string | null): string {
  if (iso === null) {
    return '—'
  }

  const parsed = new Date(iso)

  return Number.isNaN(parsed.getTime()) ? iso : parsed.toLocaleTimeString()
}

/** An ISO-8601 instant from the API as a local date and time, for the history table. */
export function formatIsoDateTime(iso: string | null): string {
  if (iso === null) {
    return '—'
  }

  const parsed = new Date(iso)

  return Number.isNaN(parsed.getTime()) ? iso : parsed.toLocaleString()
}

/** Cooldown/age in seconds, for policy copy. */
export function formatSeconds(milliseconds: number): string {
  return `${Math.round(milliseconds / 1000)} s`
}

/** Shortens a UUID so it can be shown in a status panel without dominating it. */
export function formatShortId(id: string): string {
  return id.length <= 8 ? id : `${id.slice(0, 8)}…`
}
