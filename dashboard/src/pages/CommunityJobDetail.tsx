import { Icon } from '../components/Icon'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { UserJob } from '@job-hunter/shared'
import { apiFetch } from '../api/client'
import { PublicNav } from '../components/Nav'
import { FormError } from '../components/FormError'
import { Pill } from '../components/Pill'
import { LogoChip } from '../components/LogoChip'
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

// Read-only, public detail view for a job another member added and shared.
// Backed by GET /jobs/community/:id, which only returns jobs their owner marked
// public — so this works for any visitor, unlike the owner-scoped /my-jobs/:id.
export function CommunityJobDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [job, setJob] = useState<UserJob | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    apiFetch(`/jobs/community/${id}`)
      .then(async (res) => {
        if (!res.ok) {
          setError(res.status === 404 ? 'Job not found.' : 'Failed to load job.')
          return
        }
        setJob(await res.json())
      })
      .catch(() => setError('Failed to load job.'))
  }, [id])

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
                <Pill tone="verified">Community</Pill>
                <Pill tone="mono">Shared by a member</Pill>
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
                <div className="t">Added</div>
                <div className="v">{formatDate(job.createdAt)}</div>
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
              {job.url ? (
                <a href={job.url} target="_blank" rel="noreferrer" className="btn btn-indigo">
                  Apply
                </a>
              ) : (
                <button type="button" className="btn btn-indigo" disabled>
                  No apply link
                </button>
              )}
            </div>
          </div>
        </aside>
      </div>

      <Footer />
    </div>
  )
}
