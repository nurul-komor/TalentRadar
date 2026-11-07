import { Icon } from '../components/Icon'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { Profile, UserJob, UserJobVisibility } from '@job-hunter/shared'
import { apiFetch } from '../api/client'
import { PublicNav } from '../components/Nav'
import { FormError } from '../components/FormError'
import { Pill } from '../components/Pill'
import { LogoChip } from '../components/LogoChip'
import { ApplyDrawer } from '../components/ApplyDrawer'
import { Footer } from '../components/Footer'

function formatSalary(job: Pick<UserJob, 'salaryMin' | 'salaryMax'>): string {
  if (job.salaryMin == null && job.salaryMax == null) return '—'
  if (job.salaryMin != null && job.salaryMax != null) {
    return `$${job.salaryMin.toLocaleString()} – $${job.salaryMax.toLocaleString()}`
  }
  return `$${(job.salaryMin ?? job.salaryMax)?.toLocaleString()}`
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

function hostFromUrl(url: string | null): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

export function MyJobDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [job, setJob] = useState<UserJob | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [syncBusy, setSyncBusy] = useState(false)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  useEffect(() => {
    apiFetch(`/user-jobs/${id}`).then(async (res) => {
      if (!res.ok) {
        setError(res.status === 404 ? 'Job not found.' : 'Failed to load job.')
        return
      }
      setJob(await res.json())
    })
    apiFetch('/profile')
      .then((res) => (res.ok ? (res.json() as Promise<Profile>) : null))
      .then(setProfile)
      .catch(() => setProfile(null))
  }, [id])

  async function toggleVisibility() {
    if (!job?._id) return
    const next: UserJobVisibility = job.visibility === 'private' ? 'public' : 'private'
    setBusy(true)
    try {
      const res = await apiFetch(`/user-jobs/${job._id}`, {
        method: 'PATCH',
        body: JSON.stringify({ visibility: next }),
      })
      if (res.ok) setJob(await res.json())
    } finally {
      setBusy(false)
    }
  }

  // Re-fetch this job from its original URL and refresh the stored fields in
  // place. Only available for link-synced jobs (those that carry a `url`).
  async function forceSync() {
    if (!job?._id || syncBusy) return
    setSyncBusy(true)
    setSyncMessage(null)
    try {
      const res = await apiFetch(`/user-jobs/${job._id}/resync`, { method: 'POST' })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setSyncMessage(body?.error ?? 'Force sync failed.')
        return
      }
      setJob(body)
      setSyncMessage('Synced from source.')
    } catch {
      setSyncMessage('Force sync failed.')
    } finally {
      setSyncBusy(false)
    }
  }

  async function remove() {
    if (!job?._id) return
    setBusy(true)
    try {
      const res = await apiFetch(`/user-jobs/${job._id}`, { method: 'DELETE' })
      if (res.ok) {
        navigate('/jobs')
        return
      }
    } finally {
      setBusy(false)
    }
  }

  if (!job && !error) {
    return (
      <div>
        <PublicNav />
        <p className="wrap" style={{ marginTop: 24, color: 'var(--muted-text)' }}>
          Loading…
        </p>
      </div>
    )
  }

  if (error || !job) {
    return (
      <div>
        <PublicNav />
        <div className="wrap" style={{ marginTop: 24 }}>
          <FormError message={error ?? 'Job not found.'} />
        </div>
      </div>
    )
  }

  const sourceHost = hostFromUrl(job.url)

  return (
    <div>
      <PublicNav />
      <div className="wrap crumbs">
        <Link to="/jobs">Jobs</Link>
        <span>/</span>
        <span>{job.title}</span>
      </div>

      <div className="wrap job-layout">
        <div>
          <div className="job-head">
            <LogoChip name={job.company} size={56} />
            <div>
              <div className="title-row">
                <h1>{job.title}</h1>
                {job.url && (
                  <a
                    href={job.url}
                    target="_blank"
                    rel="noreferrer"
                    className="title-link"
                    title="View original posting"
                    aria-label="View original posting"
                  >
                    <Icon name="open-outline" style={{ fontSize: 18 }} />
                  </a>
                )}
              </div>
              <div className="meta">
                <span>
                  <Icon name="business-outline" />
                  {job.company}
                </span>
                <span>
                  <Icon name="location-outline" />
                  {job.location ?? 'Location unknown'}
                </span>
                <span>
                  <Icon name="wallet-outline" />
                  {formatSalary(job)}
                </span>
                <span>
                  <Icon name="calendar-outline" />
                  {formatDate(job.createdAt)}
                </span>
              </div>
              <div className="fcard-meta" style={{ marginTop: 12 }}>
                <Pill tone={job.visibility === 'public' ? 'verified' : 'mono'}>
                  {job.visibility === 'public' ? 'Public' : 'Private'}
                </Pill>
                <Pill tone="mono">Added by you</Pill>
              </div>
            </div>
          </div>

          <div className="prose">
            <h2>Description</h2>
            {job.description ? (
              <p style={{ whiteSpace: 'pre-wrap' }}>{job.description}</p>
            ) : (
              <p style={{ color: 'var(--muted-text)' }}>No description added for this job.</p>
            )}
          </div>
        </div>

        <aside className="evidence">
          <div className="ev-card">
            <div className="ev-kv">
              <div>
                <div className="t">Compensation</div>
                <div className="v">{formatSalary(job)}</div>
              </div>
              <div>
                <div className="t">Visibility</div>
                <div className="v">{job.visibility === 'public' ? 'Public' : 'Private'}</div>
              </div>
            </div>
          </div>

          {job.url && (
            <div className="ev-card">
              <div className="src-link">
                <span className="fav">{(sourceHost ?? job.company).slice(0, 2).toUpperCase()}</span>
                <div>
                  <span>{job.company}</span>
                  <small>{sourceHost ? `via ${sourceHost}` : 'Added manually'}</small>
                </div>
              </div>
            </div>
          )}

          <div className="ev-card">
            <div className="ev-actions">
              <button type="button" className="btn btn-indigo" onClick={() => setDrawerOpen(true)}>
                Apply
              </button>
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={toggleVisibility}>
                Make {job.visibility === 'private' ? 'public' : 'private'}
              </button>
              {job.url && (
                <button type="button" className="btn btn-ghost" disabled={syncBusy} onClick={forceSync}>
                  <Icon name="refresh-outline" />
                  {syncBusy ? 'Syncing…' : 'Force sync'}
                </button>
              )}
              <button type="button" className="btn btn-ghost aj-danger" disabled={busy} onClick={remove}>
                <Icon name="trash-outline" />
                Delete
              </button>
            </div>
            {syncMessage && <p className="ev-sync-msg">{syncMessage}</p>}
          </div>
        </aside>
      </div>

      <ApplyDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        sourceId="userJob"
        sourceJobId={job._id ?? ''}
        company={job.company}
        title={job.title}
        applyUrl={job.url}
        profile={profile}
        onProfileChange={setProfile}
      />

      <Footer />
    </div>
  )
}
