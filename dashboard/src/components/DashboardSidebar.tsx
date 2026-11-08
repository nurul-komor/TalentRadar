import { Icon } from './Icon'
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import type { Profile, TrackedJob } from '@job-hunter/shared'
import { apiFetch } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { canSync, isAdmin } from '../lib/syncAccess'
import { useSavedJobs } from '../hooks/useSavedJobs'
import { profileCompletenessPercent } from '../lib/profileCompleteness'
import { isFollowUpOverdue } from '../lib/jobTracking'
import { ThemeToggle } from './ThemeToggle'

function BrandMark() {
  return (
    <span className="brand-mark">
      <img src="/logo.png" alt="Hunter" />
    </span>
  )
}

function sidebarLinkClass({ isActive }: { isActive: boolean }): string {
  return isActive ? 'app-sidebar-link current' : 'app-sidebar-link'
}

const SIDEBAR_LINKS = [
  { to: '/dashboard', label: 'Dashboard', icon: 'grid-outline' },
  { to: '/suggestions', label: 'Suggested', icon: 'sparkles-outline' },
  { to: '/add-job', label: 'Add Job', icon: 'add-outline' },
  { to: '/applications', label: 'Applications', icon: 'clipboard-outline' },
  { to: '/profile', label: 'Profile', icon: 'person-outline' },
  { to: '/cv', label: 'Resume', icon: 'document-text-outline' },
]

function initialsFromEmail(email: string | null): string {
  if (!email) return '?'
  const local = email.split('@')[0] ?? ''
  const parts = local.split(/[._-]/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return local.slice(0, 2).toUpperCase()
}

// Shared account popover. Opens from the sidebar foot (desktop) or the mobile
// top-header avatar (tablet/phone) and surfaces the account's important links +
// log out. Saved Jobs and Job Sync live here too because they are not in the
// mobile tab bar.
function AccountMenu({ variant, title, subtitle }: { variant: 'sidebar' | 'header'; title?: string; subtitle?: string }) {
  const { email, logout } = useAuth()
  const { savedIds } = useSavedJobs()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLDivElement>(null)

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent) {
      if (!anchorRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const links = [
    { to: '/profile', label: 'Profile', icon: 'person-outline', badge: 0 },
    { to: '/cv', label: 'Resume', icon: 'document-text-outline', badge: 0 },
    { to: '/jobs?saved=1', label: 'Saved Jobs', icon: 'briefcase-outline', badge: savedIds.length },
    ...(canSync(email) ? [{ to: '/sync', label: 'Job Sync', icon: 'refresh-outline', badge: 0 }] : []),
    ...(isAdmin(email) ? [{ to: '/settings', label: 'Settings', icon: 'settings-outline', badge: 0 }] : []),
  ]

  function go(to: string) {
    setOpen(false)
    navigate(to)
  }

  const menu = open && (
    <div className="account-menu" role="menu">
      <div className="account-menu-head">
        <span className="avatar" aria-hidden="true">
          {initialsFromEmail(email)}
        </span>
        <span className="who">{email ?? 'Account'}</span>
      </div>
      {links.map(({ to, label, icon, badge }) => (
        <button key={to} type="button" role="menuitem" className="account-menu-item" onClick={() => go(to)}>
          <Icon name={icon} style={{ fontSize: 18 }} />
          {label}
          {badge > 0 && <span className="badge">{badge}</span>}
        </button>
      ))}
      <div className="account-menu-row">
        <span>Theme</span>
        <ThemeToggle />
      </div>
      <button
        type="button"
        role="menuitem"
        className="account-menu-item danger"
        onClick={() => {
          setOpen(false)
          logout()
        }}
      >
        <Icon name="log-out-outline" style={{ fontSize: 18 }} />
        Log out
      </button>
    </div>
  )

  if (variant === 'header') {
    return (
      <div className="app-mobile-header-account account-anchor" ref={anchorRef}>
        <button
          type="button"
          className={`app-mobile-header-avatar${open ? ' current' : ''}`}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Account"
          onClick={() => setOpen((v) => !v)}
        >
          <span className="avatar" aria-hidden="true">
            {initialsFromEmail(email)}
          </span>
        </button>
        {menu}
      </div>
    )
  }

  return (
    <div className="app-sidebar-foot account-anchor" ref={anchorRef}>
      <button
        type="button"
        className="app-sidebar-foot-trigger"
        title={email ?? 'Account'}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="avatar" aria-hidden="true">
          {initialsFromEmail(email)}
        </span>
        <span className="who">
          <b>{title ?? email ?? 'Account'}</b>
          <span>{subtitle}</span>
        </span>
        <Icon name={open ? 'chevron-down-outline' : 'chevron-up-outline'} className="chev" />
      </button>
      {menu}
    </div>
  )
}

export function DashboardSidebar() {
  const { email } = useAuth()
  const { savedIds } = useSavedJobs()
  const navigate = useNavigate()
  const location = useLocation()
  const searchRef = useRef<HTMLInputElement>(null)
  const navRef = useRef<HTMLDivElement>(null)
  const [searchValue, setSearchValue] = useState('')
  const [profile, setProfile] = useState<Profile | null>(null)
  const [trackedJobs, setTrackedJobs] = useState<TrackedJob[]>([])
  // The sliding "pill" behind the active nav link. We track the active link's
  // position so a single indicator element can transition between items.
  const [indicator, setIndicator] = useState<{ top: number; height: number; ready: boolean }>({
    top: 0,
    height: 0,
    ready: false,
  })

  useEffect(() => {
    apiFetch('/profile')
      .then((res) => (res.ok ? (res.json() as Promise<Profile>) : null))
      .then(setProfile)
      .catch(() => setProfile(null))
    apiFetch('/job-tracking')
      .then((res) => (res.ok ? res.json() : { jobs: [] }))
      .then((body: { jobs: TrackedJob[] }) => setTrackedJobs(body.jobs))
      .catch(() => setTrackedJobs([]))
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== '/') return
      const active = document.activeElement
      const isTyping = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
      if (isTyping) return
      event.preventDefault()
      searchRef.current?.focus()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  // Overdue follow-ups are the thing worth nudging the user toward on the tracker.
  const overdueCount = trackedJobs.filter((job) => isFollowUpOverdue(job.followUpDate, job.status)).length

  // Reposition the sliding indicator to the active link whenever the route
  // changes or the nav's contents/size shift (badges, resize).
  useLayoutEffect(() => {
    const nav = navRef.current
    if (!nav) return
    function reposition() {
      const current = nav!.querySelector<HTMLElement>('.app-sidebar-link.current')
      if (!current) {
        setIndicator((prev) => ({ ...prev, ready: false }))
        return
      }
      setIndicator({ top: current.offsetTop, height: current.offsetHeight, ready: true })
    }
    reposition()
    const observer = new ResizeObserver(reposition)
    observer.observe(nav)
    return () => observer.disconnect()
  }, [location.pathname, location.search, savedIds.length, overdueCount, email])

  function submitSearch(event: React.FormEvent) {
    event.preventDefault()
    const trimmed = searchValue.trim()
    navigate(trimmed ? `/jobs?q=${encodeURIComponent(trimmed)}` : '/jobs')
  }

  return (
    <nav className="app-sidebar">
      <NavLink to="/" className="brand app-sidebar-brand">
        <BrandMark />
        Hunter
      </NavLink>

      <form className="app-sidebar-search" onSubmit={submitSearch}>
        <Icon name="search-outline" style={{ fontSize: 15 }} />
        <input
          ref={searchRef}
          type="text"
          placeholder="Search jobs"
          value={searchValue}
          onChange={(event) => setSearchValue(event.target.value)}
        />
        <kbd>/</kbd>
      </form>

      <div className="app-sidebar-nav" ref={navRef}>
        <span
          className="app-sidebar-indicator"
          aria-hidden="true"
          style={{
            transform: `translateY(${indicator.top}px)`,
            height: indicator.height,
            opacity: indicator.ready ? 1 : 0,
          }}
        />
        {SIDEBAR_LINKS.map(({ to, label, icon }) => (
          <NavLink key={to} to={to} className={sidebarLinkClass}>
            <Icon name={icon} style={{ fontSize: 18 }} />
            {label}
            {to === '/applications' && overdueCount > 0 && <span className="badge">{overdueCount}</span>}
          </NavLink>
        ))}

        <div className="app-sidebar-section-label">Shortcuts</div>
        <NavLink to="/jobs?saved=1" className="app-sidebar-link">
          <Icon name="briefcase-outline" style={{ fontSize: 18 }} />
          Saved Jobs
          {savedIds.length > 0 && <span className="badge">{savedIds.length}</span>}
        </NavLink>

        {canSync(email) && (
          <NavLink to="/sync" className={sidebarLinkClass}>
            <Icon name="refresh-outline" style={{ fontSize: 18 }} />
            Job Sync
          </NavLink>
        )}

        {isAdmin(email) && (
          <NavLink to="/settings" className={sidebarLinkClass}>
            <Icon name="settings-outline" style={{ fontSize: 18 }} />
            Settings
          </NavLink>
        )}
      </div>

      {overdueCount > 0 && (
        <div className="app-sidebar-next">
          <div className="k">Next action</div>
          <b>
            Follow up on {overdueCount} job{overdueCount === 1 ? '' : 's'}
          </b>
          <NavLink to="/applications">Open tracker →</NavLink>
        </div>
      )}

      <AccountMenu
        variant="sidebar"
        title={profile?.resume?.fullName ?? email ?? 'Account'}
        subtitle={`Profile ${profile ? profileCompletenessPercent(profile) : 0}% complete`}
      />
    </nav>
  )
}

interface FabItem {
  to: string
  label: string
  icon: string
  badge?: number
  // Saved Jobs points at /jobs?saved=1, which NavLink would otherwise mark active
  // whenever the /jobs route is open — so it opts out of active styling, mirroring
  // the sidebar.
  matchActive?: boolean
}

// Mobile primary nav as a floating speed-dial at the bottom-right. The old
// full-width bottom tab bar crammed every destination into one row, so on narrow
// phones the labels clipped. A single round button that expands into a labelled,
// staggered menu scales to any width and shows each destination's full label.
// It mirrors the full desktop sidebar — primary destinations plus the Shortcuts
// (Saved Jobs, and Job Sync / Settings when the account has access).
export function DashboardMobileNav() {
  const location = useLocation()
  const { email } = useAuth()
  const { savedIds } = useSavedJobs()
  const [open, setOpen] = useState(false)

  // Collapse on navigation.
  useEffect(() => setOpen(false), [location.pathname])

  // Collapse on Escape while open.
  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const items: FabItem[] = [
    ...SIDEBAR_LINKS.map((link) => ({ ...link, matchActive: true })),
    { to: '/jobs?saved=1', label: 'Saved Jobs', icon: 'briefcase-outline', badge: savedIds.length || undefined, matchActive: false },
    ...(canSync(email) ? [{ to: '/sync', label: 'Job Sync', icon: 'refresh-outline', matchActive: true }] : []),
    ...(isAdmin(email) ? [{ to: '/settings', label: 'Settings', icon: 'settings-outline', matchActive: true }] : []),
  ]

  return (
    <div className={`app-fab${open ? ' open' : ''}`}>
      {open && (
        <button type="button" className="app-fab-scrim" aria-label="Close menu" onClick={() => setOpen(false)} />
      )}
      <nav className="app-fab-menu" aria-label="Main" aria-hidden={!open}>
        {items.map((item, index) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.matchActive ? undefined : true}
            className={({ isActive }) =>
              item.matchActive && isActive ? 'app-fab-item current' : 'app-fab-item'
            }
            style={{ '--i': index } as CSSProperties}
            tabIndex={open ? 0 : -1}
          >
            <span className="app-fab-item-label">
              {item.label}
              {item.badge ? <span className="app-fab-item-badge">{item.badge}</span> : null}
            </span>
            <span className="app-fab-item-icon">
              <Icon name={item.icon} style={{ fontSize: 20 }} />
            </span>
          </NavLink>
        ))}
      </nav>
      <button
        type="button"
        className="app-fab-button"
        aria-expanded={open}
        aria-label={open ? 'Close navigation menu' : 'Open navigation menu'}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name={open ? 'close-outline' : 'menu-outline'} style={{ fontSize: 24 }} />
      </button>
    </div>
  )
}

// Mobile-only top header: brand on the left, account avatar on the right. The
// account popover lives here (not in the bottom tab bar) so all six primary
// destinations fit the fixed bottom nav without clipping on narrow phones.
export function DashboardMobileHeader() {
  return (
    <header className="app-mobile-header">
      <NavLink to="/" className="brand app-mobile-header-brand">
        <BrandMark />
        Hunter
      </NavLink>
      <AccountMenu variant="header" />
    </header>
  )
}
