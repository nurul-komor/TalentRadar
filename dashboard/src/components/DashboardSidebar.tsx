import { NavLink } from 'react-router-dom'
import { ClipboardList, FileText, LayoutDashboard, User } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { ThemeToggle } from './ThemeToggle'

function BrandMark() {
  return (
    <span className="brand-mark">
      <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12l5 5L20 6" />
      </svg>
    </span>
  )
}

function sidebarLinkClass({ isActive }: { isActive: boolean }): string {
  return isActive ? 'app-sidebar-link current' : 'app-sidebar-link'
}

const SIDEBAR_LINKS = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/applications', label: 'Applications', icon: ClipboardList },
  { to: '/profile', label: 'Profile', icon: User },
  { to: '/cv', label: 'CV', icon: FileText },
]

function initialsFromEmail(email: string | null): string {
  if (!email) return '?'
  const local = email.split('@')[0] ?? ''
  const parts = local.split(/[._-]/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return local.slice(0, 2).toUpperCase()
}

export function DashboardSidebar() {
  const { email, logout } = useAuth()

  return (
    <nav className="app-sidebar">
      <NavLink to="/" className="brand app-sidebar-brand">
        <BrandMark />
        Hunter
      </NavLink>

      <div className="app-sidebar-nav">
        {SIDEBAR_LINKS.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} className={sidebarLinkClass}>
            <Icon size={18} />
            {label}
          </NavLink>
        ))}
      </div>

      <div className="app-sidebar-foot">
        <ThemeToggle />
        <button type="button" className="avatar" title={email ?? 'Account'} aria-label="Log out" onClick={logout}>
          {initialsFromEmail(email)}
        </button>
      </div>
    </nav>
  )
}

export function DashboardSidebarTopBar() {
  const { email, logout } = useAuth()

  return (
    <nav className="nav app-sidebar-topbar">
      <div className="wrap nav-row">
        <NavLink to="/" className="brand">
          <BrandMark />
          Hunter
        </NavLink>
        <div className="nav-links">
          {SIDEBAR_LINKS.map(({ to, label }) => (
            <NavLink key={to} to={to} className={({ isActive }) => (isActive ? 'current' : '')}>
              {label}
            </NavLink>
          ))}
        </div>
        <div className="nav-cta">
          <ThemeToggle />
          <button type="button" className="avatar" title={email ?? 'Account'} aria-label="Log out" onClick={logout}>
            {initialsFromEmail(email)}
          </button>
        </div>
      </div>
    </nav>
  )
}
