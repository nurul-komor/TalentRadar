import { Outlet } from 'react-router-dom'
import { DashboardSidebar, DashboardSidebarTopBar, DashboardMobileHeader } from './DashboardSidebar'

export function DashboardLayout() {
  return (
    <div className="app-shell">
      <DashboardSidebar />
      <DashboardMobileHeader />
      <DashboardSidebarTopBar />
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  )
}
