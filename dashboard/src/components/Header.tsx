import { NavLink } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Button } from './Button'

const NAV_LINKS = [
  { to: '/jobs', label: 'Jobs' },
  { to: '/profile', label: 'Profile' },
]

function navLinkClasses({ isActive }: { isActive: boolean }): string {
  return `text-sm font-medium ${isActive ? 'text-blue-600' : 'text-slate-600 hover:text-slate-900'}`
}

export function Header() {
  const { logout } = useAuth()
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 sm:gap-x-8">
          <span className="text-base font-semibold text-slate-900 sm:text-lg">AI Remote Job Hunter</span>
          <nav className="flex items-center gap-4 sm:gap-6">
            {NAV_LINKS.map((link) => (
              <NavLink key={link.to} to={link.to} className={navLinkClasses}>
                {link.label}
              </NavLink>
            ))}
          </nav>
        </div>
        <Button variant="secondary" onClick={logout}>
          Log out
        </Button>
      </div>
    </header>
  )
}
