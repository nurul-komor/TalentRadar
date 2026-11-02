import { Outlet } from 'react-router-dom'
import { DashboardSidebar, DashboardSidebarTopBar } from './DashboardSidebar'

export function DashboardLayout() {
  return (
    <div className="app-shell">
      <DashboardSidebar />
      <DashboardSidebarTopBar />
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  )
}
