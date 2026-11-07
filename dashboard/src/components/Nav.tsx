import { Icon } from './Icon'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { Menu as MenuPrimitive } from '@base-ui/react/menu'
import { useAuth } from '../auth/AuthContext'
import { ThemeToggle } from './ThemeToggle'

// Hides the nav when scrolling down and reveals it when scrolling back up.
// Always visible near the top of the page.
function useHideOnScroll(): boolean {
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    let last = window.scrollY
    let ticking = false
    function update() {
      const y = window.scrollY
      if (y < 80) setHidden(false)
      else if (y > last + 6) setHidden(true)
      else if (y < last - 6) setHidden(false)
      last = y
      ticking = false
    }
    function onScroll() {
      if (ticking) return
      ticking = true
      requestAnimationFrame(update)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return hidden
}

function BrandMark() {
  return (
    <span className="brand-mark">
      <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12l5 5L20 6" />
      </svg>
    </span>
  )
}

function navLinkClass({ isActive }: { isActive: boolean }): string {
  return isActive ? 'current' : ''
}

// Horizontal nav links with a single "pill" that slides between items to mark
// the active route — mirrors the dashboard sidebar's sliding indicator.
function NavLinks({ links }: { links: { to: string; label: string }[] }) {
  const location = useLocation()
  const ref = useRef<HTMLDivElement>(null)
  const [indicator, setIndicator] = useState<{ left: number; width: number; ready: boolean }>({
    left: 0,
    width: 0,
    ready: false,
  })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    function reposition() {
      const current = el!.querySelector<HTMLElement>('a.current')
      if (!current) {
        setIndicator((prev) => ({ ...prev, ready: false }))
        return
      }
      setIndicator({ left: current.offsetLeft, width: current.offsetWidth, ready: true })
    }
    reposition()
    const observer = new ResizeObserver(reposition)
    observer.observe(el)
    return () => observer.disconnect()
  }, [location.pathname])

  return (
    <div className="nav-links" ref={ref}>
      <span
        className="nav-links-indicator"
        aria-hidden="true"
        style={{
          transform: `translateX(${indicator.left}px)`,
          width: indicator.width,
          opacity: indicator.ready ? 1 : 0,
        }}
      />
      {links.map((link) => (
        <NavLink key={link.to} to={link.to} className={navLinkClass}>
          {link.label}
        </NavLink>
      ))}
    </div>
  )
}

function NavMenuToggle({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className="nav-menu-toggle"
      aria-expanded={open}
      aria-label={open ? 'Close menu' : 'Open menu'}
      onClick={onClick}
    >
      {open ? (
        <Icon name="close-outline" style={{ fontSize: 20 }} />
      ) : (
        <Icon name="menu-outline" style={{ fontSize: 20 }} />
      )}
    </button>
  )
}

const PUBLIC_LINKS = [
  { to: '/jobs', label: 'Jobs' },
  { to: '/how-it-works', label: 'How It Works' },
  { to: '/scoring', label: 'Scoring' },
  { to: '/sources', label: 'Sources' },
]

export function PublicNav() {
  const { isAuthenticated } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const closeMenu = () => setMenuOpen(false)
  const hidden = useHideOnScroll()

  return (
    <nav className={`nav${hidden && !menuOpen ? ' nav-hidden' : ''}`}>
      <div className="wrap nav-row">
        <NavLink to="/" className="brand" onClick={closeMenu}>
          <BrandMark />
          Hunter
        </NavLink>
        <NavLinks links={PUBLIC_LINKS} />
        <div className="nav-cta">
          <ThemeToggle />
          {isAuthenticated ? (
            <NavLink to="/dashboard" className="btn btn-primary nav-cta-btn">
              Dashboard
            </NavLink>
          ) : (
            <>
              <NavLink to="/login" className="btn btn-ghost nav-cta-btn">
                Log in
              </NavLink>
              <NavLink to="/register" className="btn btn-primary nav-cta-btn">
                Create profile
              </NavLink>
            </>
          )}
          <NavMenuToggle open={menuOpen} onClick={() => setMenuOpen((open) => !open)} />
        </div>
      </div>
      {menuOpen && (
        <div className="wrap nav-mobile-panel">
          {PUBLIC_LINKS.map((link) => (
            <NavLink key={link.to} to={link.to} className={navLinkClass} onClick={closeMenu}>
              {link.label}
            </NavLink>
          ))}
          <div className="nav-mobile-cta">
            {isAuthenticated ? (
              <NavLink to="/dashboard" className="btn btn-primary" onClick={closeMenu}>
                Dashboard
              </NavLink>
            ) : (
              <>
                <NavLink to="/login" className="btn btn-ghost" onClick={closeMenu}>
                  Log in
                </NavLink>
                <NavLink to="/register" className="btn btn-primary" onClick={closeMenu}>
                  Create profile
                </NavLink>
              </>
            )}
          </div>
        </div>
      )}
    </nav>
  )
}

const APP_LINKS = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/jobs', label: 'Jobs' },
  { to: '/applications', label: 'Applications' },
  { to: '/profile', label: 'Profile' },
  { to: '/cv', label: 'Resume' },
]

const ACCOUNT_MENU_LINKS = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/profile', label: 'Profile' },
  { to: '/cv', label: 'Resume' },
]

function initialsFromEmail(email: string | null): string {
  if (!email) return '?'
  const local = email.split('@')[0] ?? ''
  const parts = local.split(/[._-]/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return local.slice(0, 2).toUpperCase()
}

export function AppNav() {
  const { email, logout } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const closeMenu = () => setMenuOpen(false)
  const hidden = useHideOnScroll()

  return (
    <nav className={`nav app-nav${hidden && !menuOpen ? ' nav-hidden' : ''}`}>
      <div className="wrap nav-row">
        <NavLink to="/" className="brand" onClick={closeMenu}>
          <BrandMark />
          Hunter
        </NavLink>
        <NavLinks links={APP_LINKS} />
        <div className="nav-cta">
          <ThemeToggle />
          <MenuPrimitive.Root>
            <MenuPrimitive.Trigger className="avatar" title={email ?? 'Account'} aria-label="Account menu">
              {initialsFromEmail(email)}
            </MenuPrimitive.Trigger>
            <MenuPrimitive.Portal>
              <MenuPrimitive.Positioner className="nav-account-positioner" side="bottom" align="end" sideOffset={8}>
                <MenuPrimitive.Popup className="nav-account-popup">
                  {ACCOUNT_MENU_LINKS.map((link) => (
                    <MenuPrimitive.Item key={link.to} className="nav-account-item" render={<NavLink to={link.to} />}>
                      {link.label}
                    </MenuPrimitive.Item>
                  ))}
                  <MenuPrimitive.Separator className="nav-account-sep" />
                  <MenuPrimitive.Item className="nav-account-item nav-account-item-danger" onClick={logout}>
                    Log out
                  </MenuPrimitive.Item>
                </MenuPrimitive.Popup>
              </MenuPrimitive.Positioner>
            </MenuPrimitive.Portal>
          </MenuPrimitive.Root>
          <NavMenuToggle open={menuOpen} onClick={() => setMenuOpen((open) => !open)} />
        </div>
      </div>
      {menuOpen && (
        <div className="wrap nav-mobile-panel">
          {APP_LINKS.map((link) => (
            <NavLink key={link.to} to={link.to} className={navLinkClass} onClick={closeMenu}>
              {link.label}
            </NavLink>
          ))}
          <div className="nav-mobile-cta">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                closeMenu()
                logout()
              }}
            >
              Log out
            </button>
          </div>
        </div>
      )}
    </nav>
  )
}
