import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Profile } from '@job-hunter/shared'
import { apiFetch } from '../../api/client'
import { Icon } from '../../components/Icon'
import { ScoreRing } from '../../components/ScoreRing'
import { useCountUp } from '../../hooks/useCountUp'
import { useScrollReveal } from '../../hooks/useScrollReveal'
import { relativeTimeFromNow } from '../../lib/relativeTime'

interface DiscoveryStatus {
  totalJobs: number
  mostRecentDiscoveredAt: string | null
}

interface VectorStatus {
  mode: string
  embeddingModel: string | null
  dimensions: number | null
  embedderReady: boolean
  vectorSearch: string
  counts: { total: number; embedded: number; pending: number; unembedded: number }
}

// Initials for the recent-signups avatars, mirroring the dashboard's avatar chips.
function initialsFor(user: Profile): string {
  const name = user.resume?.fullName?.trim()
  const source = name && name.length > 0 ? name : user.email
  const parts = source.split(/[\s@._-]+/).filter(Boolean)
  const letters = (parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')
  return (letters || source[0] || '?').toUpperCase()
}

function displayNameFor(user: Profile): string {
  return user.resume?.fullName?.trim() || user.email
}

// Count-up KPI card, same markup/motion as the user dashboard's KPI row.
function AdminKpi({
  icon,
  value,
  label,
  accent = false,
  warn = false,
}: {
  icon: string
  value: number | null
  label: string
  accent?: boolean
  warn?: boolean
}) {
  const count = useCountUp(value)
  const toneClass = warn && (value ?? 0) > 0 ? ' warn' : accent ? ' accent' : ''
  return (
    <div className={`kpi${toneClass}`}>
      <div className="kpi-ico">
        <Icon name={icon} />
      </div>
      <div className="kpi-body">
        <div className="kpi-n tabular-nums">
          {value === null ? (
            <span className="sk" style={{ display: 'inline-block', height: 28, width: '58%' }} />
          ) : (
            count.toLocaleString()
          )}
        </div>
        <div className="kpi-l">{label}</div>
      </div>
    </div>
  )
}

// Horizontal proportion bar (restrained: accent + neutral only), as on the dashboard.
function SegBar({ segments }: { segments: Array<{ value: number; color: string }> }) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0)
  if (total === 0) return <div className="propbar" />
  return (
    <div className="propbar">
      {segments.map((segment, index) =>
        segment.value > 0 ? (
          <span
            key={index}
            className="propbar-fill"
            style={{ width: `${(segment.value / total) * 100}%`, background: segment.color }}
          />
        ) : null,
      )}
    </div>
  )
}

const QUICK_LINKS = [
  { to: '/admin/users', label: 'Users', desc: 'Browse accounts & impersonate', icon: 'people-outline' },
  { to: '/sync', label: 'Job Sync', desc: 'Run discovery across sources', icon: 'refresh-outline' },
  { to: '/settings', label: 'AI Settings', desc: 'Credentials, vectors & files', icon: 'settings-outline' },
]

export function AdminOverviewPage() {
  const [users, setUsers] = useState<Profile[] | null>(null)
  const [status, setStatus] = useState<DiscoveryStatus | null>(null)
  const [vectors, setVectors] = useState<VectorStatus | null>(null)

  const revealRef = useScrollReveal<HTMLDivElement>({ selector: '.kpi, .tile', y: 24, stagger: 0.06 })

  useEffect(() => {
    apiFetch('/admin/users')
      .then((res) => (res.ok ? (res.json() as Promise<{ users: Profile[] }>) : null))
      .then((body) => setUsers(body?.users ?? []))
      .catch(() => setUsers([]))
    apiFetch('/admin/discovery/status')
      .then((res) => (res.ok ? (res.json() as Promise<DiscoveryStatus>) : null))
      .then((body) => setStatus(body ?? { totalJobs: 0, mostRecentDiscoveredAt: null }))
      .catch(() => setStatus({ totalJobs: 0, mostRecentDiscoveredAt: null }))
    apiFetch('/admin/vectors/status')
      .then((res) => (res.ok ? (res.json() as Promise<VectorStatus>) : null))
      .then((body) => setVectors(body))
      .catch(() => setVectors(null))
  }, [])

  const userCount = users?.length ?? null
  // "New this week" — a live pulse of signups, like the dashboard's follow-ups KPI.
  const newThisWeek = useMemo(() => {
    if (!users) return null
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
    return users.filter((u) => u.createdAt && new Date(u.createdAt).getTime() >= weekAgo).length
  }, [users])
  const recentSignups = useMemo(() => (users ?? []).slice(0, 5), [users])

  const counts = vectors?.counts
  const embeddedPct = counts && counts.total > 0 ? Math.round((counts.embedded / counts.total) * 100) : 0

  const systemRows: Array<{ label: string; value: string; ready: boolean | null }> = vectors
    ? [
        { label: 'Embedding mode', value: vectors.mode || '—', ready: null },
        {
          label: 'Embedder',
          value: vectors.embedderReady ? 'Ready' : 'Not configured',
          ready: vectors.embedderReady,
        },
        {
          label: 'Vector search',
          value: vectors.vectorSearch === 'in-memory-fallback' ? 'In-memory fallback' : 'Atlas / native',
          ready: vectors.vectorSearch !== 'in-memory-fallback',
        },
        {
          label: 'Last discovered',
          value: status?.mostRecentDiscoveredAt ? relativeTimeFromNow(status.mostRecentDiscoveredAt) : 'never',
          ready: null,
        },
      ]
    : []

  return (
    <>
      <header className="page-head">
        <div className="wrap welcome">
          <div className="big-ring">
            <ScoreRing score={embeddedPct} size={96} strokeWidth={7} />
          </div>
          <div>
            <div className="kicker">Admin</div>
            <h1>Platform overview</h1>
            <p>
              {vectors === null || userCount === null
                ? 'Gathering a snapshot of the platform…'
                : `${userCount.toLocaleString()} ${userCount === 1 ? 'account' : 'accounts'} · ${(
                    status?.totalJobs ?? 0
                  ).toLocaleString()} jobs · ${embeddedPct}% of suggestible jobs embedded.`}
            </p>
            <div className="quick">
              <Link to="/admin/users" className="btn btn-indigo">
                Manage users
              </Link>
              <Link to="/sync" className="btn btn-ghost">
                Run job sync
              </Link>
              <Link to="/settings" className="btn btn-ghost">
                AI settings
              </Link>
            </div>
          </div>
        </div>
      </header>

      <section className="page-pad">
        <div className="wrap" ref={revealRef}>
          <div className="kpis">
            <AdminKpi accent icon="people-outline" value={userCount} label="Total users" />
            <AdminKpi icon="briefcase-outline" value={status?.totalJobs ?? null} label="Total jobs" />
            <AdminKpi icon="sparkles-outline" value={counts?.embedded ?? null} label="Jobs embedded" />
            <AdminKpi warn icon="time-outline" value={counts?.pending ?? null} label="Embeds pending" />
          </div>

          <div className="bento">
            {/* Quick tools */}
            <div className="tile span-4">
              <h3>Admin tools</h3>
              <div className="saved" style={{ marginTop: 14 }}>
                {QUICK_LINKS.map(({ to, label, desc, icon }) => (
                  <Link to={to} key={to} className="saved-row group">
                    <span className="saved-badge">
                      <Icon name={icon} />
                    </span>
                    <span className="saved-info">
                      <span className="saved-role">{label}</span>
                      <span className="saved-co">{desc}</span>
                    </span>
                    <Icon name="chevron-forward-outline" className="saved-chevron" />
                  </Link>
                ))}
              </div>
            </div>

            {/* Embedding coverage */}
            <div className="tile span-8">
              <h3>
                Embedding coverage
                <Link to="/settings">Vector manager</Link>
              </h3>
              {vectors === null ? (
                <p className="tile-empty">Loading index health…</p>
              ) : counts && counts.total === 0 ? (
                <p className="tile-empty">No suggestible jobs to embed yet.</p>
              ) : (
                <>
                  <div className="stats">
                    <div className="stat2">
                      <div className="n tabular-nums">{counts?.embedded ?? 0}</div>
                      <div className="l">Embedded</div>
                    </div>
                    <div className="stat2">
                      <div className="n tabular-nums">{counts?.unembedded ?? 0}</div>
                      <div className="l">Unembedded</div>
                    </div>
                  </div>
                  <SegBar
                    segments={[
                      { value: counts?.embedded ?? 0, color: 'var(--indigo)' },
                      { value: counts?.unembedded ?? 0, color: 'var(--line-strong)' },
                    ]}
                  />
                  <div className="propbar-legend">
                    <span>
                      <i style={{ background: 'var(--indigo)' }} />
                      {embeddedPct}% embedded
                    </span>
                    <span>
                      <i style={{ background: 'var(--line-strong)' }} />
                      {counts?.unembedded ?? 0} remaining
                    </span>
                    {(counts?.pending ?? 0) > 0 && (
                      <span>
                        <i style={{ background: 'var(--muted-text)' }} />
                        {counts?.pending} pending
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* System status */}
            <div className="tile span-6">
              <h3>System status</h3>
              {vectors === null ? (
                <p className="tile-empty">Checking runtime…</p>
              ) : (
                <ul className="activity">
                  {systemRows.map((row) => (
                    <li key={row.label}>
                      <span className={`d${row.ready === true ? ' i' : row.ready === false ? ' g' : ''}`} />
                      <span>
                        {row.value}
                        <small>{row.label}</small>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Recent signups */}
            <div className="tile span-6">
              <h3>
                Recent signups
                <Link to="/admin/users">
                  {newThisWeek != null && newThisWeek > 0 ? `+${newThisWeek} this week` : 'View all'}
                </Link>
              </h3>
              {users === null ? (
                <p className="tile-empty">Loading accounts…</p>
              ) : recentSignups.length === 0 ? (
                <p className="tile-empty">No accounts yet.</p>
              ) : (
                <div className="saved" style={{ marginTop: 12 }}>
                  {recentSignups.map((user) => (
                    <Link to="/admin/users" key={user._id ?? user.email} className="saved-row">
                      <span className="avatar" aria-hidden="true">
                        {initialsFor(user)}
                      </span>
                      <span className="saved-info">
                        <span className="saved-role">{displayNameFor(user)}</span>
                        <span className="saved-co">{user.email}</span>
                      </span>
                      <span className="saved-time">
                        <Icon name="time-outline" />
                        {user.createdAt ? relativeTimeFromNow(user.createdAt) : '—'}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
