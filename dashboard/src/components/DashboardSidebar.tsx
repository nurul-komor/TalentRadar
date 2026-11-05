import { useEffect, useRef, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import type { Application, Profile } from '@job-hunter/shared'
import { apiFetch } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { canSync } from '../lib/syncAccess'
import { useSavedJobs } from '../hooks/useSavedJobs'
import { profileCompletenessPercent } from '../lib/profileCompleteness'
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
  { to: '/dashboard', label: 'Dashboard', icon: 'grid-outline' },
  { to: '/add-job', label: 'Add job', icon: 'add-outline' },
  { to: '/applications', label: 'Applications', icon: 'clipboard-outline' },
  { to: '/profile', label: 'Profile', icon: 'person-outline' },
  { to: '/cv', label: 'CV', icon: 'document-text-outline' },
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
  const { savedIds } = useSavedJobs()
  const navigate = useNavigate()
  const searchRef = useRef<HTMLInputElement>(null)
  const [searchValue, setSearchValue] = useState('')
  const [profile, setProfile] = useState<Profile | null>(null)
  const [applications, setApplications] = useState<Application[]>([])

  useEffect(() => {
    apiFetch('/profile')
      .then((res) => (res.ok ? (res.json() as Promise<Profile>) : null))
      .then(setProfile)
      .catch(() => setProfile(null))
    apiFetch('/applications')
      .then((res) => (res.ok ? res.json() : { applications: [] }))
      .then((body: { applications: Application[] }) => setApplications(body.applications))
      .catch(() => setApplications([]))
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

  function submitSearch(event: React.FormEvent) {
    event.preventDefault()
    const trimmed = searchValue.trim()
    navigate(trimmed ? `/jobs?q=${encodeURIComponent(trimmed)}` : '/jobs')
  }

  const readyCount = applications.filter((application) => application.status === 'ready').length

  return (
    <nav className="app-sidebar">
      <NavLink to="/" className="brand app-sidebar-brand">
        <BrandMark />
        Hunter
      </NavLink>

      <form className="app-sidebar-search" onSubmit={submitSearch}>
        <ion-icon name="search-outline" style={{ fontSize: 15 }} />
        <input
          ref={searchRef}
          type="text"
          placeholder="Search jobs"
          value={searchValue}
          onChange={(event) => setSearchValue(event.target.value)}
        />
        <kbd>/</kbd>
      </form>

      <div className="app-sidebar-nav">
        {SIDEBAR_LINKS.map(({ to, label, icon }) => (
          <NavLink key={to} to={to} className={sidebarLinkClass}>
            <ion-icon name={icon} style={{ fontSize: 18 }} />
            {label}
            {to === '/applications' && readyCount > 0 && <span className="badge">{readyCount}</span>}
          </NavLink>
        ))}

        <div className="app-sidebar-section-label">Shortcuts</div>
        <NavLink to="/jobs?saved=1" className="app-sidebar-link">
          <ion-icon name="briefcase-outline" style={{ fontSize: 18 }} />
          Saved jobs
          {savedIds.length > 0 && <span className="badge">{savedIds.length}</span>}
        </NavLink>

        {canSync(email) && (
          <NavLink to="/sync" className={sidebarLinkClass}>
            <ion-icon name="refresh-outline" style={{ fontSize: 18 }} />
            Job sync
          </NavLink>
        )}
      </div>

      {readyCount > 0 && (
        <div className="app-sidebar-next">
          <div className="k">Next action</div>
          <b>
            Review {readyCount} generated cover letter{readyCount === 1 ? '' : 's'}
          </b>
          <NavLink to="/applications">Review now →</NavLink>
        </div>
      )}

      <div className="app-sidebar-foot">
        <button type="button" className="avatar" title={email ?? 'Account'} aria-label="Log out" onClick={logout}>
          {initialsFromEmail(email)}
        </button>
        <div className="who">
          <b>{profile?.resume?.fullName ?? email ?? 'Account'}</b>
          <span>Profile {profile ? profileCompletenessPercent(profile) : 0}% complete</span>
        </div>
        <ThemeToggle />
      </div>
    </nav>
  )
}

export function DashboardSidebarTopBar() {
  return (
    <nav className="app-mobile-tabs" aria-label="Main">
      {SIDEBAR_LINKS.map(({ to, label, icon }) => (
        <NavLink key={to} to={to} className={sidebarLinkClass}>
          <ion-icon name={icon} style={{ fontSize: 18 }} />
          {label}
        </NavLink>
      ))}
    </nav>
  )
}
