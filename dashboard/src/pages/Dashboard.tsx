import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Application, ApplicationStatus, Job, Profile, TrackedJob, UserJob } from '@job-hunter/shared'
import { apiFetch } from '../api/client'
import { ScoreRing } from '../components/ScoreRing'
import { Pill } from '../components/Pill'
import { FormError } from '../components/FormError'
import { useSavedJobs } from '../hooks/useSavedJobs'
import { profileCompletenessPercent } from '../lib/profileCompleteness'
import { STATUS_GROUPS, countTrackedJobsByGroup, isFollowUpOverdue } from '../lib/jobTracking'

interface JobsResponseBody {
  jobs: Job[]
  total: number
}

interface ApplicationsResponseBody {
  applications: Application[]
}

interface TrackedJobsResponseBody {
  jobs: TrackedJob[]
}

// A saved bookmark can point at either a discovered job or a job the user added
// themselves; both are resolved into this shared shape for the saved-jobs list.
interface SavedJobEntry {
  _id: string
  title: string
  company: string
  location: string | null
  salaryMin: number | null
  salaryMax: number | null
  score: number | null
  // 'discovered' jobs come from the global feed (and carry a match score);
  // 'added' jobs are ones the user saved themselves.
  kind: 'discovered' | 'added'
  savedAt: string | null
  detailPath: string
}

// Compact salary range for the saved-job cards; returns null when unknown so the
// row can be omitted rather than showing an empty dash.
function formatSalaryRange(salaryMin: number | null, salaryMax: number | null): string | null {
  if (salaryMin == null && salaryMax == null) return null
  if (salaryMin != null && salaryMax != null) {
    return `$${salaryMin.toLocaleString()} – $${salaryMax.toLocaleString()}`
  }
  return `$${(salaryMin ?? salaryMax)?.toLocaleString()}`
}

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

function activityDotClass(status: ApplicationStatus): string {
  if (status === 'ready') return 'd i'
  if (status === 'submitted') return 'd'
  return 'd g'
}

// Time-of-day greeting so the header feels alive on repeat visits.
function greetingFor(hour: number): string {
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

function firstNameOf(profile: Profile | null): string {
  const full = profile?.resume?.fullName?.trim()
  if (!full) return ''
  return full.split(/\s+/)[0]
}

// Horizontal proportion bar. Zero total renders a single muted track so the card
// never collapses to an empty strip.
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

// Pipeline groups get a distinct colour each so the proportion bar and legend stay readable.
const GROUP_COLORS: Record<string, string> = {
  applied: 'var(--indigo)',
  interviewing: 'var(--cyan)',
  offer: '#16a34a',
  rejected: 'var(--line-strong)',
}

// The AI materials feed has four states; ready/submitted/draft are the ones
// worth charting, failed is called out separately only when present.
const MATERIAL_SEGMENTS: Array<{ key: ApplicationStatus; label: string; color: string }> = [
  { key: 'ready', label: 'Ready', color: 'var(--cyan)' },
  { key: 'submitted', label: 'Submitted', color: 'var(--indigo)' },
  { key: 'draft', label: 'Draft', color: 'var(--line-strong)' },
]

export function DashboardPage() {
  const { savedIds } = useSavedJobs()

  const [profile, setProfile] = useState<Profile | null>(null)

  const [recommendedJobs, setRecommendedJobs] = useState<Array<Job & { _id: string; matchScore?: number }>>([])
  const [jobsError, setJobsError] = useState<string | null>(null)

  const [applications, setApplications] = useState<Application[] | null>(null)
  const [applicationsError, setApplicationsError] = useState<string | null>(null)

  const [trackedJobs, setTrackedJobs] = useState<TrackedJob[] | null>(null)
  const [trackedJobsError, setTrackedJobsError] = useState<string | null>(null)

  const [savedJobs, setSavedJobs] = useState<SavedJobEntry[]>([])

  useEffect(() => {
    apiFetch('/profile')
      .then((res) => (res.ok ? (res.json() as Promise<Profile>) : null))
      .then(setProfile)
      .catch(() => setProfile(null))
  }, [])

  // Recommendations come from the semantic /suggestions endpoint — jobs ranked by how well they
  // match the user's resume — rather than the rule-based score (which is 0 until a job is scored).
  // A 404 means suggestions aren't configured on the server; just show the empty state quietly.
  useEffect(() => {
    apiFetch('/suggestions?limit=4')
      .then(async (res) => {
        if (res.status === 404) return
        if (!res.ok) {
          setJobsError('Failed to load recommended jobs.')
          return
        }
        const data: { suggestions: Array<{ job: Job & { _id: string }; semanticScore: number }> } =
          await res.json()
        setRecommendedJobs(data.suggestions.map((s) => ({ ...s.job, matchScore: s.semanticScore })))
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

  // The pipeline card mirrors the /applications tracker page, so it reads the
  // same /job-tracking source rather than the generated-document feed.
  useEffect(() => {
    apiFetch('/job-tracking')
      .then(async (res) => {
        if (!res.ok) {
          setTrackedJobsError('Failed to load applications.')
          return
        }
        const data: TrackedJobsResponseBody = await res.json()
        setTrackedJobs(data.jobs)
      })
      .catch(() => setTrackedJobsError('Failed to load applications.'))
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
              location: job.location,
              salaryMin: job.salaryMin,
              salaryMax: job.salaryMax,
              score: job.score ?? null,
              kind: 'discovered',
              savedAt: job.discoveredAt,
              detailPath: `/jobs/${id}`,
            }
          }
          const userRes = await apiFetch(`/user-jobs/${id}`)
          if (userRes.ok) {
            const job = (await userRes.json()) as UserJob
            return {
              _id: id,
              title: job.title,
              company: job.company,
              location: job.location,
              salaryMin: job.salaryMin,
              salaryMax: job.salaryMax,
              score: null,
              kind: 'added',
              savedAt: job.createdAt,
              detailPath: `/my-jobs/${id}`,
            }
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
  const groupCounts = useMemo(() => countTrackedJobsByGroup(trackedJobs ?? []), [trackedJobs])
  const overdueCount = useMemo(
    () => (trackedJobs ?? []).filter((job) => isFollowUpOverdue(job.followUpDate, job.status)).length,
    [trackedJobs],
  )
  const totalTracked = trackedJobs?.length ?? 0

  // AI-generated materials grouped by status for the "Application materials" card.
  const materialCounts = useMemo(() => {
    const counts: Record<ApplicationStatus, number> = { draft: 0, ready: 0, submitted: 0, failed: 0 }
    for (const application of applications ?? []) counts[application.status] += 1
    return counts
  }, [applications])
  const totalMaterials = applications?.length ?? 0

  const recentActivity = useMemo(
    () =>
      [...(applications ?? [])]
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .slice(0, 5),
    [applications],
  )

  const greeting = greetingFor(new Date().getHours())
  const firstName = firstNameOf(profile)

  return (
    <>
      <header className="page-head">
        <div className="wrap welcome">
          <div className="big-ring">
            <ScoreRing score={completeness ?? 0} size={96} strokeWidth={7} />
          </div>
          <div>
            <h1>
              {greeting}
              {firstName ? `, ${firstName}` : ''}.
            </h1>
            <p>
              {completeness != null
                ? completeness >= 100
                  ? 'Your profile is complete — everything is ready for stronger job matches.'
                  : `Your profile is ${completeness}% complete. Finish it for sharper matches and better materials.`
                : 'Loading your profile…'}
            </p>
            <div className="quick">
              <Link to="/jobs" className="btn btn-indigo">
                Browse jobs
              </Link>
              <Link to="/add-job" className="btn btn-ghost">
                Add a job
              </Link>
              <Link to="/profile" className="btn btn-ghost">
                {completeness != null && completeness >= 100 ? 'Edit profile' : 'Complete profile'}
              </Link>
            </div>
          </div>
        </div>
      </header>

      <section className="page-pad">
        <div className="wrap">
          {/* Top-line metrics across the whole tracked pipeline. */}
          <div className="kpis">
            <div className="kpi accent">
              <div className="kpi-ico">
                <ion-icon name="briefcase-outline" />
              </div>
              <div className="kpi-body">
                <div className="kpi-n">{totalTracked}</div>
                <div className="kpi-l">Jobs tracked</div>
              </div>
            </div>
            <div className="kpi teal">
              <div className="kpi-ico">
                <ion-icon name="people-outline" />
              </div>
              <div className="kpi-body">
                <div className="kpi-n">{groupCounts.interviewing}</div>
                <div className="kpi-l">Interviewing</div>
              </div>
            </div>
            <div className="kpi">
              <div className="kpi-ico">
                <ion-icon name="ribbon-outline" />
              </div>
              <div className="kpi-body">
                <div className="kpi-n">{groupCounts.offer}</div>
                <div className="kpi-l">Offers</div>
              </div>
            </div>
            <Link to="/applications" className={`kpi${overdueCount > 0 ? ' warn' : ''}`}>
              <div className="kpi-ico">
                <ion-icon name={overdueCount > 0 ? 'alert-circle-outline' : 'time-outline'} />
              </div>
              <div className="kpi-body">
                <div className="kpi-n">{overdueCount}</div>
                <div className="kpi-l">Follow-ups due</div>
              </div>
            </Link>
          </div>

          <div className="bento">
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
                  <p>Looking for application materials waiting on your approval.</p>
                </div>
              ) : nextApplication ? (
                <>
                  <div>
                    <div className="k">Next action</div>
                    <h2>{nextApplication.title}</h2>
                    <p>
                      {nextApplication.company} — resume &amp; cover letter ready for review since{' '}
                      {relativeTimeFromNow(nextApplication.createdAt)}.
                    </p>
                  </div>
                  <Link to="/applications" className="btn">
                    Review &amp; confirm
                  </Link>
                </>
              ) : (
                <>
                  <div>
                    <div className="k">Next action</div>
                    <h2>You're all caught up</h2>
                    <p>No AI-generated materials are waiting on your approval right now.</p>
                  </div>
                  <Link to="/jobs" className="btn">
                    Find your next role
                  </Link>
                </>
              )}
            </div>

            <div className="tile span-8">
              <h3>
                Recommended for you
                <Link to="/jobs">Browse all</Link>
              </h3>
              {jobsError && <FormError message={jobsError} />}
              {!jobsError && recommendedJobs.length === 0 ? (
                <p className="tile-empty">
                  Add your resume to get personalised job matches. <Link to="/cv">Add resume →</Link>
                </p>
              ) : (
                <div className="hlist">
                  {recommendedJobs.map((job) => (
                    <Link to={`/jobs/${job._id}`} key={job._id} className="jobcard">
                      <div className="top">
                        <div>
                          <div className="role">{job.title}</div>
                          <div className="co">
                            <ion-icon
                              name="business-outline"
                              style={{ fontSize: 12, display: 'inline-block', verticalAlign: 'middle', marginRight: 4 }}
                            />
                            {job.company}
                            {job.location ? ` · ${job.location}` : ''}
                          </div>
                        </div>
                        <ScoreRing score={Math.round(job.matchScore ?? job.score ?? 0)} size={40} />
                      </div>
                      <div className="tags">
                        {typeof job.matchScore === 'number' && (
                          <Pill tone="verified">{Math.round(job.matchScore)}% match</Pill>
                        )}
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

            <div className="tile span-6">
              <h3>
                Application pipeline
                <Link to="/applications">Open tracker</Link>
              </h3>
              {trackedJobsError && <FormError message={trackedJobsError} />}
              {!trackedJobsError && (
                <>
                  <div className="stats">
                    {STATUS_GROUPS.map(({ group, label }) => (
                      <div className="stat2" key={group}>
                        <div className="n">{groupCounts[group]}</div>
                        <div className="l">{label}</div>
                      </div>
                    ))}
                  </div>
                  <SegBar
                    segments={STATUS_GROUPS.map(({ group }) => ({
                      value: groupCounts[group],
                      color: GROUP_COLORS[group],
                    }))}
                  />
                  <div className="propbar-legend">
                    {STATUS_GROUPS.map(({ group, label }) => (
                      <span key={group}>
                        <i style={{ background: GROUP_COLORS[group] }} />
                        {label}
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div className="tile span-6">
              <h3>
                Application materials
                <Link to="/applications">View all</Link>
              </h3>
              {applicationsError ? (
                <FormError message={applicationsError} />
              ) : totalMaterials === 0 ? (
                <p className="tile-empty">
                  No AI-generated resumes or cover letters yet. Open a job to generate tailored materials.
                </p>
              ) : (
                <>
                  <div className="stats">
                    {MATERIAL_SEGMENTS.map(({ key, label }) => (
                      <div className="stat2" key={key}>
                        <div className="n">{materialCounts[key]}</div>
                        <div className="l">{label}</div>
                      </div>
                    ))}
                  </div>
                  <SegBar
                    segments={MATERIAL_SEGMENTS.map(({ key, color }) => ({ value: materialCounts[key], color }))}
                  />
                  <div className="propbar-legend">
                    {MATERIAL_SEGMENTS.map(({ key, label, color }) => (
                      <span key={key}>
                        <i style={{ background: color }} />
                        {label}
                      </span>
                    ))}
                    {materialCounts.failed > 0 && (
                      <span>
                        <i style={{ background: '#e5484d' }} />
                        {materialCounts.failed} failed
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>

            <div className="tile span-6">
              <h3>
                Saved jobs
                <Link to="/jobs?saved=1">View all</Link>
              </h3>
              {savedJobs.length === 0 ? (
                <p className="tile-empty">No saved jobs yet. Bookmark one from the job feed to keep it here.</p>
              ) : (
                <div className="saved">
                  {savedJobs.slice(0, 5).map((job) => {
                    const salary = formatSalaryRange(job.salaryMin, job.salaryMax)
                    return (
                      <Link to={job.detailPath} key={job._id} className="saved-row">
                        {job.score != null ? (
                          <ScoreRing score={job.score} size={36} />
                        ) : (
                          <span className="saved-badge" title="A job you added yourself">
                            <ion-icon name="bookmark-outline" />
                          </span>
                        )}
                        <span className="saved-info">
                          <span className="saved-role">{job.title}</span>
                          <span className="saved-co">
                            {job.company}
                            {job.location ? ` · ${job.location}` : ''}
                          </span>
                          <span className="saved-meta">
                            {salary && <span className="saved-salary">{salary}</span>}
                            {job.savedAt && (
                              <span className="saved-time">
                                <ion-icon name="time-outline" /> Saved {relativeTimeFromNow(job.savedAt)}
                              </span>
                            )}
                          </span>
                        </span>
                        <ion-icon name="chevron-forward-outline" className="saved-chevron" />
                      </Link>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="tile span-6">
              <h3>Recent activity</h3>
              {applicationsError && <FormError message={applicationsError} />}
              {!applicationsError && recentActivity.length === 0 ? (
                <p className="tile-empty">No application activity yet.</p>
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
        </div>
      </section>
    </>
  )
}
