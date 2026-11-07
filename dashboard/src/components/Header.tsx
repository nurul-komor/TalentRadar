import { Icon } from './Icon'
import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Button } from './Button'

const NAV_LINKS = [
  { to: '/jobs', label: 'Jobs' },
  { to: '/profile', label: 'Profile' },
]

const ADMIN_NAV_LINK = { to: '/admin', label: 'Admin' }

function desktopNavLinkClasses({ isActive }: { isActive: boolean }): string {
  return `inline-flex items-center border-b-2 px-1 pt-1 text-sm font-medium ${
    isActive
      ? 'border-blue-600 text-slate-900'
      : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'
  }`
}

function mobileNavLinkClasses({ isActive }: { isActive: boolean }): string {
  return `block border-l-4 py-2 pl-3 pr-4 text-base font-medium ${
    isActive
      ? 'border-blue-600 bg-blue-50 text-blue-700'
      : 'border-transparent text-slate-600 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800'
  }`
}

export function Header() {
  const { logout, isAdmin } = useAuth()
  const [mobileOpen, setMobileOpen] = useState(false)
  const navLinks = isAdmin ? [...NAV_LINKS, ADMIN_NAV_LINK] : NAV_LINKS

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto max-w-7xl px-4">
        <div className="flex h-16 justify-between">
          <div className="flex">
            <span className="flex shrink-0 items-center text-lg font-semibold text-slate-900">
              AI Remote Job Hunter
            </span>
            <nav className="hidden sm:ms-10 sm:flex sm:space-x-8">
              {navLinks.map((link) => (
                <NavLink key={link.to} to={link.to} className={desktopNavLinkClasses}>
                  {link.label}
                </NavLink>
              ))}
            </nav>
          </div>

          <div className="hidden sm:flex sm:items-center">
            <Button variant="ghost" onClick={logout}>
              Log out
            </Button>
          </div>

          <div className="flex items-center sm:hidden">
            <button
              type="button"
              onClick={() => setMobileOpen((open) => !open)}
              aria-expanded={mobileOpen}
              className="inline-flex items-center justify-center rounded-md p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-500"
            >
              <span className="sr-only">Open main menu</span>
              {mobileOpen ? (
                <Icon name="close-outline" style={{ fontSize: 24 }} />
              ) : (
                <Icon name="menu-outline" style={{ fontSize: 24 }} />
              )}
            </button>
          </div>
        </div>
      </div>

      {mobileOpen && (
        <div className="sm:hidden">
          <nav className="space-y-1 pb-3 pt-2">
            {navLinks.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={mobileNavLinkClasses}
                onClick={() => setMobileOpen(false)}
              >
                {link.label}
              </NavLink>
            ))}
          </nav>
          <div className="border-t border-slate-200 pb-3 pt-4">
            <div className="px-4">
              <Button
                variant="ghost"
                className="w-full justify-center"
                onClick={() => {
                  setMobileOpen(false)
                  logout()
                }}
              >
                Log out
              </Button>
            </div>
          </div>
        </div>
      )}
    </header>
  )
}
