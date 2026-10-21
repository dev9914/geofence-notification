import { NavLink, Outlet } from 'react-router-dom'
import { Crosshair, LayoutDashboard, Navigation } from 'lucide-react'
import { API_BASE_URL } from '../config/env'

/**
 * Application shell: header, primary navigation and the routed page area.
 *
 * The visitor tracking page and the admin dashboard share this frame, so the dashboard can
 * be filled in without restructuring the application.
 */
export default function AppShell() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header__brand">
          <span className="app-header__mark" aria-hidden="true">
            <Crosshair size={22} />
          </span>
          <span className="app-header__titles">
            <strong>Geofence Notifications</strong>
            <small>Real-time GPS entry tracking</small>
          </span>
        </div>

        <nav className="app-nav" aria-label="Primary">
          <NavLink
            to="/"
            end
            className={({ isActive }) => (isActive ? 'app-nav__link app-nav__link--active' : 'app-nav__link')}
          >
            <Navigation size={16} aria-hidden="true" />
            Visitor tracking
          </NavLink>
          <NavLink
            to="/admin"
            className={({ isActive }) => (isActive ? 'app-nav__link app-nav__link--active' : 'app-nav__link')}
          >
            <LayoutDashboard size={16} aria-hidden="true" />
            Admin dashboard
          </NavLink>
        </nav>
      </header>

      <main className="app-main">
        <Outlet />
      </main>

      <footer className="app-footer">
        <span>
          API base URL: <code>{API_BASE_URL}</code>
        </span>
        <span>Location data is used only to compare your position with the configured geofence.</span>
      </footer>
    </div>
  )
}
