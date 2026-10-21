/// <reference types="vite/client" />

/**
 * Environment variables exposed to the browser bundle.
 *
 * Vite only exposes variables prefixed with `VITE_`, and their values are inlined into the
 * built JavaScript, so anyone can read them. Never put a secret (API key, database
 * credential, token) in one.
 */
interface ImportMetaEnv {
  /** Base URL of the geofence API, for example `http://localhost:3000`. */
  readonly VITE_API_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
