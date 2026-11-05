import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Application, ApplicationStatus, Job, Profile, UserJob } from '@job-hunter/shared'
import { apiFetch } from '../api/client'
import { ScoreRing } from '../components/ScoreRing'
import { Pill } from '../components/Pill'
import { FormError } from '../components/FormError'
import { useSavedJobs } from '../hooks/useSavedJobs'
import { profileCompletenessPercent } from '../lib/profileCompleteness'

interface JobsResponseBody {
  jobs: Job[]
  total: number
}

interface ApplicationsResponseBody {
  applications: Application[]
}

// A saved bookmark can point at either a discovered job or a job the user added
// themselves; both are resolved into this shared shape for the saved-jobs list.
interface SavedJobEntry {
  _id: string
  title: string
  company: string
  score: number | null
  detailPath: string
}

const STATUS_COLUMNS: Array<{ status: ApplicationStatus; label: string }> = [
  { status: 'draft', label: 'Draft' },
  { status: 'ready', label: 'Ready for approval' },
  { status: 'submitted', label: 'Submitted' },
  { status: 'failed', label: 'Failed' },
]

function relativeTimeFromNow(dateString: string): string {
  const diffSeconds = Math.round((Date.now() - new Date(dateString).getTime()) / 1000)
  const diffMinutes = Math.round(diffSeconds / 60)
  const diffHours = Math.round(diffMinutes / 60)
  const diffDays = Math.round(diffHours / 24)

  if (diffSeconds < 60) return 'just now'
  if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`
  if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`
  if (diffDays < 30) {
    const diffWeeks = Math.round(diffDays / 7)
    return `${diffWeeks} week${diffWeeks === 1 ? '' : 's'} ago`
  }
  const diffMonths = Math.round(diffDays / 30)
  return `${diffMonths} month${diffMonths === 1 ? '' : 's'} ago`
}

function oldestReadyApplication(applications: Application[]): Application | null {
  const ready = applications.filter((application) => application.status === 'ready')
  if (ready.length === 0) return null
  return ready.reduce((oldest, current) =>
    new Date(current.createdAt).getTime() < new Date(oldest.createdAt).getTime() ? current : oldest,
  )
}

function countApplicationsByStatus(applications: Application[]): Record<ApplicationStatus, number> {
  const counts: Record<ApplicationStatus, number> = { draft: 0, ready: 0, submitted: 0, failed: 0 }
  for (const application of applications) counts[application.status] += 1
  return counts
}

function activityDotClass(status: ApplicationStatus): string {
  if (status === 'ready') return 'd i'
  if (status === 'submitted') return 'd'
  return 'd g'
}

export function DashboardPage() {
  const { savedIds } = useSavedJobs()

  const [profile, setProfile] = useState<Profile | null>(null)

  const [recommendedJobs, setRecommendedJobs] = useState<Job[]>([])
  const [jobsError, setJobsError] = useState<string | null>(null)

  const [applications, setApplications] = useState<Application[] | null>(null)
  const [applicationsError, setApplicationsError] = useState<string | null>(null)

  const [savedJobs, setSavedJobs] = useState<SavedJobEntry[]>([])

  useEffect(() => {
    apiFetch('/profile')
      .then((res) => (res.ok ? (res.json() as Promise<Profile>) : null))
      .then(setProfile)
      .catch(() => setProfile(null))
  }, [])

  useEffect(() => {
    apiFetch('/jobs?status=verified&limit=4')
      .then(async (res) => {
        if (!res.ok) {
          setJobsError('Failed to load recommended jobs.')
          return
        }
        const data: JobsResponseBody = await res.json()
        setRecommendedJobs([...data.jobs].sort((a, b) => (b.score ?? -1) - (a.score ?? -1)))
      })
      .catch(() => setJobsError('Failed to load recommended jobs.'))
  }, [])

  useEffect(() => {
    apiFetch('/applications')
      .then(async (res) => {
        if (!res.ok) {
          setApplicationsError('Failed to load applications.')
          return
        }
        const data: ApplicationsResponseBody = await res.json()
        setApplications(data.applications)
      })
      .catch(() => setApplicationsError('Failed to load applications.'))
  }, [])

  useEffect(() => {
    if (savedIds.length === 0) {
      setSavedJobs([])
      return
    }
    let cancelled = false
    // A bookmark may be a discovered job or one the user added. Try the global
    // feed first, then fall back to the user's own jobs so both resolve.
    Promise.all(
      savedIds.map(async (id): Promise<SavedJobEntry | null> => {
        try {
          const res = await apiFetch(`/jobs/${id}`)
          if (res.ok) {
            const job = (await res.json()) as Job
            return {
              _id: id,
              title: job.title,
              company: job.company,
              score: job.score ?? null,
              detailPath: `/jobs/${id}`,
            }
          }
          const userRes = await apiFetch(`/user-jobs/${id}`)
          if (userRes.ok) {
            const job = (await userRes.json()) as UserJob
            return { _id: id, title: job.title, company: job.company, score: null, detailPath: `/my-jobs/${id}` }
          }
          return null
        } catch {
          return null
        }
      }),
    ).then((jobs) => {
      if (cancelled) return
      setSavedJobs(jobs.filter((job): job is SavedJobEntry => job !== null))
    })
    return () => {
      cancelled = true
    }
  }, [savedIds])

  const completeness = profile ? profileCompletenessPercent(profile) : null
  const nextApplication = applications ? oldestReadyApplication(applications) : null
  const statusCounts = useMemo(() => countApplicationsByStatus(applications ?? []), [applications])
  const recentActivity = useMemo(
    () =>
      [...(applications ?? [])]
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .slice(0, 6),
    [applications],
  )

  return (
    <>
        <header className="page-head">
          <div className="wrap welcome">
            <div className="big-ring">
              <ScoreRing score={completeness ?? 0} size={96} strokeWidth={7} />
            </div>
            <div>
              <h1>Welcome back.</h1>
              <p>
                {completeness != null
                  ? `Your profile is ${completeness}% complete.`
                  : 'Loading your profile…'}
              </p>
              <div className="quick">
                <Link to="/jobs" className="btn btn-indigo">
                  Browse jobs
                </Link>
                <Link to="/profile" className="btn btn-ghost">
                  Complete profile
                </Link>
                <Link to="/applications" className="btn btn-ghost">
                  View applications
                </Link>
              </div>
            </div>
          </div>
        </header>
  
        <section className="page-pad">
          <div className="wrap bento">
            <div className="tile next span-4">
              {applicationsError ? (
                <div>
                  <div className="k">Next action</div>
                  <h2>Unavailable</h2>
                  <p>{applicationsError}</p>
                </div>
              ) : applications === null ? (
                <div>
                  <div className="k">Next action</div>
                  <h2>Checking…</h2>
                  <p>Looking for applications waiting on your approval.</p>
                </div>
              ) : nextApplication ? (
                <>
                  <div>
                    <div className="k">Next action</div>
                    <h2>{nextApplication.title}</h2>
                    <p>
                      {nextApplication.company} — ready for approval since{' '}
                      {relativeTimeFromNow(nextApplication.createdAt)}.
                    </p>
                  </div>
                  <Link to="/applications" className="btn">
                    Review &amp; confirm
                  </Link>
                </>
              ) : (
                <div>
                  <div className="k">Next action</div>
                  <h2>Nothing pending</h2>
                  <p>No applications are waiting on your approval right now.</p>
                </div>
              )}
            </div>
  
            <div className="tile span-8">
              <h3>Recommended for you</h3>
              {jobsError && <FormError message={jobsError} />}
              {!jobsError && recommendedJobs.length === 0 ? (
                <p style={{ marginTop: 16, color: 'var(--muted-text)', fontSize: 14 }}>
                  No verified jobs to recommend yet — check back soon.
                </p>
              ) : (
                <div className="hlist">
                  {recommendedJobs.map((job) => (
                    <Link to={`/jobs/${job._id}`} key={job._id} className="jobcard">
                      <div className="top">
                        <div>
                          <div className="role">{job.title}</div>
                          <div className="co">
                            <ion-icon name="business-outline" style={{ fontSize: 12, display: 'inline-block', verticalAlign: 'middle', marginRight: 4 }} />
                            {job.company}
                            {job.location ? ` · ${job.location}` : ''}
                          </div>
                        </div>
                        <ScoreRing score={job.score ?? 0} size={40} />
                      </div>
                      <div className="tags">
                        <Pill tone="verified">Verified</Pill>
                      </div>
                      <div className="foot">
                        <span className="src">{relativeTimeFromNow(job.discoveredAt)}</span>
                        <span className="apply">View role →</span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
  
            <div className="tile span-4">
              <h3>Applications</h3>
              {applicationsError && <FormError message={applicationsError} />}
              {!applicationsError && (
                <div className="stats">
                  {STATUS_COLUMNS.map(({ status, label }) => (
                    <div className="stat2" key={status}>
                      <div className="n">{statusCounts[status]}</div>
                      <div className="l">{label}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
  
            <div className="tile span-4">
              <h3>
                Saved jobs
                <Link to="/jobs">View all</Link>
              </h3>
              {savedJobs.length === 0 ? (
                <p style={{ marginTop: 12, color: 'var(--muted-text)', fontSize: 14 }}>
                  No saved jobs yet. Save one from the job feed.
                </p>
              ) : (
                <div className="saved">
                  {savedJobs.map((job) => (
                    <Link to={`/jobs/${job._id}`} key={job._id}>
                      {job.title} · {job.company}
                      <span>{job.score != null ? `${job.score}` : '—'}</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
  
            <div className="tile span-4">
              <h3>Recent activity</h3>
              {applicationsError && <FormError message={applicationsError} />}
              {!applicationsError && recentActivity.length === 0 ? (
                <p style={{ marginTop: 12, color: 'var(--muted-text)', fontSize: 14 }}>
                  No application activity yet.
                </p>
              ) : (
                !applicationsError && (
                  <ul className="activity">
                    {recentActivity.map((application) => (
                      <li key={application.jobId}>
                        <span className={activityDotClass(application.status)} />
                        <span>
                          {application.title}
                          <small>
                            {application.company} · status changed to {application.status}
                          </small>
                        </span>
                        <span className="t">{relativeTimeFromNow(application.updatedAt)}</span>
                      </li>
                    ))}
                  </ul>
                )
              )}
            </div>
          </div>
        </section>
    </>
  )
}
