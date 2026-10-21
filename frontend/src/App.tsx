import { Navigate, Route, Routes } from 'react-router-dom'
import AppShell from './components/AppShell'
import AdminDashboardPage from './pages/AdminDashboardPage'
import VisitorTrackingPage from './pages/VisitorTrackingPage'

/**
 * Route table.
 *
 * Both routes render inside `AppShell`, so the visitor tracking page and the admin dashboard
 * share the header, the navigation and the page frame.
 */
export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<VisitorTrackingPage />} />
        <Route path="admin" element={<AdminDashboardPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
