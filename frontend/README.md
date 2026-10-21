# GPS-Based Geofence Notification

A full-stack web application that watches a visitor's real GPS position in the browser, decides
**inside / outside / uncertain** against one fixed geofence, records a notification the moment the
visitor is confirmed to have **entered**, and shows the persisted history in an admin dashboard.

- `frontend/` — React 19 + TypeScript + Vite (visitor tracking page and admin dashboard)
- `backend/` — Node.js + Express 5 + TypeScript + Mongoose + Zod (persistent REST API)
- Database — MongoDB Atlas (there is deliberately no local MongoDB fallback)

Proximity is never decided in the browser and trusted. The frontend classifies readings for the UI,
and the backend **re-validates everything** — coordinates, accuracy, distance, timestamp and geofence
membership — before a document is written.

---

## 1. Architecture

```
frontend (browser)                     backend (Node)                MongoDB Atlas
──────────────────                     ──────────────                ─────────────
useGeolocation                         Express app (src/app.ts)
  navigator.geolocation.watchPosition    GET  /health
        │                                GET  /ready
        ▼
useVisitorTracking                     /api/v1 router
  geofence/machine.ts (pure)             GET  /api/v1/geofences
        │  confirmed entry               POST /api/v1/notifications
        ▼                                GET  /api/v1/notifications
useNotificationRecorder                  GET  /api/v1/notifications/stats
  POST /api/v1/notifications  ────────▶ notificationService ─────────▶ NotificationEvent
        │  same eventId on retry          Zod schema + domain rules      (Mongoose)
        ▼
  success only after the API accepts
```

**Key design points**

- `src/hooks/useGeolocation.ts` wraps `watchPosition`; `clearWatch` runs on stop, unmount and
  `pagehide` so watchers never leak or double up.
- `src/geofence/machine.ts` is a pure state machine (no React, no I/O), so transitions and cooldown
  are deterministic and unit-testable with an injected clock.
- `src/geofence/distance.ts` (frontend) and `src/utils/coordinates.ts` (backend) both compute the
  **same Haversine distance** independently — the frontend never sends a distance, it only sends a
  raw reading.
- `backend/src/app.ts` is a listener-free, database-free app factory; `backend/src/server.ts` owns
  the process lifecycle (connect first, then listen; graceful shutdown on SIGINT/SIGTERM).
- Multiple `NotificationEvent` documents are prevented by a **unique index on `eventId`** plus the
  service's duplicate check, so a retried submission is idempotent.

---

## 2. Local setup

Requires **Node.js >= 22** (backend `engines`) and npm.

The two halves are separate projects with separate installs and are run in two terminals.

### Backend

```bash
cd backend
npm install
cp .env.example .env      # then fill in MONGODB_URI
npm run dev               # tsx watch src/server.ts  → http://localhost:3000
```

The server **refuses to start** if Atlas is unreachable or `MONGODB_URI` is missing; it exits with
code 1 instead of falling back to a local database.

Other backend scripts:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Watch-mode development server (`tsx watch`) |
| `npm run build` | Type-check and emit production JS to `dist/` (`tsc -p tsconfig.build.json`) |
| `npm start` | Run the built server (`node dist/server.js`) |
| `npm test` | Run the Vitest suite once |
| `npm run test:watch` | Vitest in watch mode |
| `npm run typecheck` | Type-check without emitting |

### Frontend

```bash
cd frontend
npm install
cp .env.example .env      # optional; only needed if the API is not on localhost:3000
npm run dev               # Vite dev server → http://localhost:5173
```

> Browser geolocation is only granted in a **secure context**: `https://` or `localhost`. The visitor
> page shows an explicit warning when the page is not in one.

Frontend scripts:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server (also enables the development simulation mode) |
| `npm run build` | `tsc -b && vite build` → static bundle in `dist/` |
| `npm run preview` | Serve the built bundle locally |
| `npm run lint` | ESLint over the project |
| `npm test` | Vitest suite once (jsdom) |

---

## 3. Environment variables

### `backend/.env`

`backend/.env` is git-ignored (`backend/.gitignore`) and must never be committed. All variables are
validated by Zod in `src/config/env.ts` at startup; nothing is read from the process environment
without passing that schema.

| Variable | Default | Notes |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development` \| `test` \| `production` |
| `PORT` | `3000` | HTTP port the Express server listens on |
| `MONGODB_URI` | *(none)* | Required to start. Must start with `mongodb://` or `mongodb+srv://`. No local fallback. |
| `FRONTEND_URL` | `http://localhost:5173` | The single origin allowed by CORS. Must start with `http://` or `https://`. |

Connection attempts are bounded by `serverSelectionTimeoutMS = 5000` and log only the **host**
(credentials, database name and query parameters are stripped).

### `frontend/.env`

Only variables prefixed with `VITE_` are exposed, and every such value is **inlined into the browser
bundle and therefore public by definition**. Never put `MONGODB_URI`, a database credential or any
other secret in a `VITE_` variable.

| Variable | Default | Notes |
| --- | --- | --- |
| `VITE_API_BASE_URL` | `http://localhost:3000` | API origin, no trailing slash and no `/api/v1` suffix. |

`frontend/.env` is git-ignored; `frontend/.env.example` is the committed template.

---

## 4. API endpoints

Base path `/api/v1`. Every response uses one of two envelopes:

```jsonc
// success
{ "status": "ok", "message": "…", "data": { } }
// error
{ "status": "error", "error": { "code": "VALIDATION_ERROR", "message": "…" } }
```

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness. Always `200` while the process is up. |
| `GET` | `/ready` | Readiness. `200` only when Mongoose is `connected`, otherwise `503` with `DATABASE_UNAVAILABLE`. |
| `GET` | `/api/v1/geofences` | The canonical demo geofence plus `enabled` and `policy`. |
| `POST` | `/api/v1/notifications` | Validate and persist one notification event. |
| `GET` | `/api/v1/notifications` | Persisted history, newest first, paged (`limit`, `offset`). |
| `GET` | `/api/v1/notifications/stats` | Database-derived totals and the latest notification timestamp. |

### `POST /api/v1/notifications` payload

A **strict** object — extra keys are rejected. Exactly these seven fields:

| Field | Type | Rule |
| --- | --- | --- |
| `eventId` | string | UUID; supplies idempotency. Reuse it when retrying the same event. |
| `sessionId` | string | 1–128 chars; an opaque client-side visitor id. |
| `geofenceId` | string | 1–128 chars; must match a known, enabled geofence. |
| `latitude` | number | −90 … 90 |
| `longitude` | number | −180 … 180 |
| `accuracyMeters` | number | ≥ 0 |
| `occurredAt` | number \| string | Integer epoch-ms or ISO-8601 with offset |

Responses: **`201`** for a newly recorded event, **`200`** with `data.duplicate = true` when the same
`eventId` was already stored (idempotent success, not an error).

Error codes: `VALIDATION_ERROR`, `STALE_READING`, `FUTURE_READING`, `ACCURACY_TOO_LOW`,
`OUTSIDE_GEOFENCE`, `GEOFENCE_NOT_FOUND`, `GEOFENCE_DISABLED`, `DUPLICATE_EVENT`,
`DATABASE_UNAVAILABLE`, `INVALID_JSON`, `PAYLOAD_TOO_LARGE`, `NOT_FOUND`, `INTERNAL_ERROR`.

> **Security note (assessment build).** No endpoint is authenticated. The API exposes a location and
> the full notification history, so this build is demo-only; a real deployment must put authenticated
> admin access in front of `/api/v1/notifications` and the dashboard. `sessionId` and `eventId` are
> client-supplied identifiers, not credentials.

---

## 5. Geofence configuration and notification logic

The single fixed demo geofence (`backend/src/config/geofence.ts`) is the only source of truth; the
coordinates are not duplicated anywhere else in the codebase, and the frontend reads them from the API.

| Setting | Value |
| --- | --- |
| id | `demo-geofence` |
| name | `Demo Geofence` |
| latitude | `18.56788997616755` |
| longitude | `73.91932741340476` |
| radius | `30` metres |
| accuracy threshold | `30` metres |
| cooldown | `60_000` ms (60 s) |

### Classification rules

A reading is evaluated in this order, and the first matching rule wins:

1. **No configuration loaded** → the reading is left unclassified (never guessed).
2. **Invalid** coordinates → rejected.
3. **Stale** — observed more than **30 s** ago → rejected.
4. **Future** — observed more than **5 s** ahead of the server clock → rejected.
5. **Out of order** — an observation time older than the last evaluated one → ignored.
6. **Distance** computed with Haversine against the geofence centre.
7. **Uncertain** — `accuracyMeters > 30` → status `uncertain`. It neither triggers a notification nor
   counts as a confirmed exit.
8. **Outside** — distance > 30 m → status `outside`.
9. **Already inside** → no duplicate notification.
10. **Cooldown active** — a notification was sent less than 60 s ago → no notification.
11. Otherwise → **enter**: the one case that records a notification.

**Boundary:** a reading at *exactly* 30 m counts as **inside**, implemented with a `1e-6` tolerance so
floating-point error cannot flip the boundary case.

### Duplicate prevention and idempotency

- The state machine only notifies on a **confirmed entry**, so repeated inside readings, re-renders and
  retries cannot each create a notification.
- After a confirmed exit the machine re-arms, so a later re-entry notifies again — subject to the
  cooldown.
- The frontend generates a UUID `eventId` per event and **reuses it when retrying the same event**.
- The backend enforces a **unique index** on `eventId`, so a duplicate submission returns the existing
  event instead of writing a second document.
- The UI shows a pending state and only reports success **after** the API accepts the event; a rejected
  submission surfaces the real API error message.

### Accuracy and cooldown limitations

- **30 m accuracy threshold.** Readings worse than ±30 m are labelled `uncertain`. On a laptop or an
  indoor connection the browser often reports accuracy far worse than this, in which case tracking will
  legitimately never confirm an entry. This is intended behaviour, not a bug — the ceiling is the same
  width as the geofence radius itself.
- **60 s cooldown.** Two confirmed entries within 60 s produce only one notification. The cooldown is
  measured against the **wall clock**, not the reading's `occurredAt`, so replaying old readings does
  not bypass it.
- **GPS drift.** Consumer GPS can wander across the 30 m boundary while a visitor is stationary. The
  cooldown is what keeps that from becoming a burst of notifications.
- **Stale readings.** Readings older than 30 s are discarded so a queued or replayed position cannot
  produce a late notification.

---

## 6. Automated tests

Everything below runs offline. Backend tests never connect to a database: the service is built on an
injectable repository, and tests use in-memory fakes. Frontend tests run in jsdom with the browser
Geolocation API **mocked** — no test asserts real GPS behaviour.

### Backend (`cd backend`)

```bash
npm test        # Vitest
npm run build   # tsc -p tsconfig.build.json
```

Covers the Haversine utility and its 30 m boundary, the state machine's transitions/cooldown/accuracy
handling, Zod schema and payload validation, the notification service (including duplicate handling),
the HTTP routes via Supertest, error JSON, and the environment schema.

### Frontend (`cd frontend`)

```bash
npm run lint
npm test
npm run build
```

Covers the distance utility, the state machine, the payload builder, the API client, the geolocation
hook (permission denial, timeout, unsupported browser, watcher cleanup), the notification recorder
(concurrency guard, retry with the same `eventId`, API-error surfacing), the visitor page, the admin
dashboard, and the development simulation helpers.

### Verification status — read this carefully

| Check | Status |
| --- | --- |
| Backend `npm test` | Run in this repository |
| Backend `npm run build` | Run in this repository |
| Frontend `npm run lint` / `npm test` / `npm run build` | Run in this repository |
| Live `POST /api/v1/notifications` persisted to Atlas and read back | Verified locally against a real Atlas cluster (see §7) |
| **Real GPS on a physical device / outdoor walk** | **Not verified.** Tests mock geolocation, and no real-device walk has been performed. |
| **Hosted deployment** | **Not verified.** No environment has been deployed; no deployment URL is claimed. |

Do not treat the mocked suites as evidence of real GPS behaviour.

---

## 7. Manual real-device test steps

Run the backend (`npm run dev`) and the frontend (`npm run dev`), then open the visitor page.

1. **Secure context.** Open `http://localhost:5173` on the same machine, or serve over HTTPS for a
   phone. Confirm no "not running in a secure context" warning is shown.
2. **Permission.** Click **Start tracking** and allow location access when prompted. Denying it should
   show a permission message and no tracking; the page must not claim success.
3. **Accuracy.** Watch the accuracy figure. If it is worse than ±30 m the status stays **uncertain** and
   no notification is produced — move outdoors or to a window until accuracy improves.
4. **Outside.** Stand clear of the geofence centre and confirm the status reads **outside**.
5. **Enter.** Walk into the 30 m radius. On the confirmed **entry** a notification is recorded —
   the panel shows it as pending until the API accepts it, then reports success.
6. **Duplicate prevention.** Stay inside and keep tracking: no second notification is produced.
7. **Exit and re-enter.** Leave the radius (status returns to **outside**, which re-arms the machine),
   then re-enter. A new notification appears, **unless** the previous one was less than 60 s ago, in
   which case the re-entry is throttled by the cooldown.
8. **Dashboard.** Open `/admin` and confirm the recorded event appears in **Recent notification
   history** with its distance, session id and reported coordinates, and that the summary cards match.
9. **Cleanup.** Stop tracking and close the tab; the page must call `clearWatch` so the browser stops
   reporting position.

For an indoor or poor-signal environment where real GPS cannot reach ±30 m accuracy, use the
development simulation mode described in §8 — and label its results as simulated, not as a real visit.

---

## 8. Development simulation mode

The visitor page includes a **Development GPS test mode** panel with three buttons:

- **Simulate outside reading** — a valid reading well outside the radius.
- **Simulate inside reading** — a valid reading exactly on the geofence centre, reported as ±5 m.
- **Simulate exit then re-entry** — applies an outside reading then an inside reading, in order.

This exists so a geofence entry can be exercised on a machine whose real GPS accuracy is too poor to
confirm one.

**How it is contained**

- It is rendered **only** inside an `import.meta.env.DEV` branch in
  `src/pages/VisitorTrackingPage.tsx`. Vite statically replaces `import.meta.env.DEV` with `false` in a
  production build, so the branch — and the panel component with it — is dropped from the bundle and
  the mode **cannot be enabled in production**.
- Real GPS remains the default. The browser watcher is always started by the **Start tracking**
  control, and a simulated reading never starts, replaces or silences that watcher. The panel's
  coordinates come from the API response (`GET /api/v1/geofences`), not from a copy in the frontend.
- Simulated readings are pushed through the **same** frontend state machine and the **same**
  notification recorder as real fixes, so duplicate prevention, cooldown, idempotency and API-error
  surfacing behave identically. Nothing writes to MongoDB directly, and the backend remains
  authoritative for coordinate, accuracy, distance, timestamp and geofence validation.
- While a simulated reading is on screen the page shows a warning that says explicitly that it is **not
  a real GPS fix**.

**Limitation — be honest about this**

The data model has **no field identifying a simulated event** (the task forbade changing the backend
API contract). A simulated entry is therefore stored indistinguishably from a real one, and the
dashboard cannot tell them apart. The "simulated" warning describes the **on-screen reading only**.
When reporting results, say clearly whether a visit was simulated or real.

---

## 9. Deployment

No environment has been deployed from this repository, and no deployment URL is claimed. The build and
start scripts below are what the two halves expose.

### Backend (Node service)

```bash
cd backend
npm ci
npm run build        # emits dist/ (test files excluded via tsconfig.build.json)
npm start            # node dist/server.js
```

- Set `NODE_ENV=production`, `PORT`, `MONGODB_URI` and `FRONTEND_URL` in the host's environment.
  `MONGODB_URI` is a **server-side secret**: set it as an environment variable, never in the frontend
  and never committed. `backend/.env` is git-ignored.
- `FRONTEND_URL` must be the deployed frontend origin, because it is the only origin CORS allows.
- Point the platform's health check at **`/health`** (liveness) and **`/ready`** (readiness). `/ready`
  returns `503` until Atlas is actually connected, so a load balancer can hold traffic back during
  startup instead of serving errors.
- The server connects to Atlas **before** it listens, and closes the HTTP server and the Mongoose
  connection on `SIGTERM`/`SIGINT`, so rolling restarts drain cleanly.
- Serve over HTTPS so the browser will grant geolocation in the deployed visitor page.

### Frontend (static host)

```bash
cd frontend
npm ci
npm run build        # static bundle in dist/
```

- Upload `dist/` to any static host. Configure the SPA rewrite so unknown paths fall back to
  `index.html` (the app routes `/` and `/admin` client-side).
- Set `VITE_API_BASE_URL` to the deployed **HTTPS** API origin at **build time** — Vite inlines it, so
  changing it requires a rebuild. It is a public value; never put a secret in a `VITE_` variable.
- Serve over HTTPS so the visitor page gets a secure context and can use geolocation.

### Not present in this repository

There is no `Dockerfile`, `Procfile`, platform config (`.ebignore`, `vercel.json`, `render.yaml`, …),
or CI workflow. The commands above are the generic entry points; add platform-specific config for the
host you actually choose.
