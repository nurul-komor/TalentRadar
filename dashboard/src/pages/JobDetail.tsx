import { Icon } from '../components/Icon'
import { useEffect, useRef, useState } from 'react'
import { Link, useParams, useNavigate, useLocation } from 'react-router-dom'
import DOMPurify from 'dompurify'
import type { Job, Profile } from '@job-hunter/shared'
import { apiFetch } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { gsap } from '../lib/gsap'
import { PublicNav } from '../components/Nav'
import { FormError } from '../components/FormError'
import { ScoreRing } from '../components/ScoreRing'
import { Pill } from '../components/Pill'
import { LogoChip } from '../components/LogoChip'
import { ApplyDrawer } from '../components/ApplyDrawer'
import { Footer } from '../components/Footer'

function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

function formatSalary(job: Job): string {
  if (job.salaryMin == null && job.salaryMax == null) return '—'
  if (job.salaryMin != null && job.salaryMax != null) {
    return `$${job.salaryMin.toLocaleString()} – $${job.salaryMax.toLocaleString()}`
  }
  return `$${(job.salaryMin ?? job.salaryMax)?.toLocaleString()}`
}

const SCORE_MAX = {
  workAuthFit: 30,
  remoteFit: 20,
  salaryFit: 20,
  skillMatch: 20,
  locationFit: 10,
} as const

const SCORE_LABELS = {
  workAuthFit: 'Work authorization',
  remoteFit: 'Remote fit',
  salaryFit: 'Compensation',
  skillMatch: 'Skills match',
  locationFit: 'Location',
} as const

export function JobDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { isAdmin, isAuthenticated } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [job, setJob] = useState<Job | null>(null)
  const [syncBusy, setSyncBusy] = useState(false)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [relatedJobs, setRelatedJobs] = useState<Job[]>([])
  const scoreCardRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    apiFetch(`/jobs/${id}`).then(async (res) => {
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

  useEffect(() => {
    if (!job) return
    const params = new URLSearchParams({ sourceId: job.sourceId, status: 'verified', limit: '4' })
    apiFetch(`/jobs?${params.toString()}`)
      .then((res) => (res.ok ? res.json() : { jobs: [] }))
      .then((body: { jobs: Job[] }) => setRelatedJobs(body.jobs.filter((candidate) => candidate._id !== job._id).slice(0, 3)))
      .catch(() => setRelatedJobs([]))
  }, [job])

  // Reuses the same GSAP ScrollTrigger mechanism as useScrollReveal (see
  // dashboard/src/hooks/useScrollReveal.ts and Landing.tsx) rather than
  // introducing a second scroll-reveal implementation. That hook hardcodes
  // an opacity/translateY tween, which doesn't fit a width-growing bar, so
  // this animates `.bar-fill` width 0 -> final% directly with the same
  // library/trigger/reduced-motion conventions once the bars have rendered.
  useEffect(() => {
    const container = scoreCardRef.current
    if (!container || !job?.scoreBreakdown) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const ctx = gsap.context(() => {
      gsap.from('.bar-fill', {
        width: '0%',
        duration: 1.1,
        stagger: 0.08,
        ease: 'power2.out',
        scrollTrigger: {
          trigger: container,
          start: 'top 80%',
        },
      })
    }, container)

    return () => ctx.revert()
  }, [job?.scoreBreakdown])

  // Operator-only: re-scrape this job from its source and refresh the stored
  // description/location in place. Normal discovery treats known jobs as
  // duplicates, so this is how a stale posting gets refreshed.
  async function forceSync() {
    if (!id || syncBusy) return
    setSyncBusy(true)
    setSyncMessage(null)
    try {
      const res = await apiFetch(`/jobs/${id}/resync`, { method: 'POST' })
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

  if (!job && !error) {
    return (
      <div>
        <PublicNav />
        <div className="wrap crumbs" aria-hidden="true">
          <div className="sk" style={{ width: 40 }} />
          <span>/</span>
          <div className="sk" style={{ width: 140 }} />
        </div>

        <div className="wrap job-layout" aria-hidden="true" aria-busy="true">
          <div>
            <div className="job-head">
              <div className="sk" style={{ width: 56, height: 56, borderRadius: 14, flex: '0 0 auto' }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
                <div className="sk" style={{ width: '60%', height: 26 }} />
                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                  <div className="sk" style={{ width: 110 }} />
                  <div className="sk" style={{ width: 90 }} />
                  <div className="sk" style={{ width: 120 }} />
                  <div className="sk" style={{ width: 100 }} />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <div className="sk" style={{ width: 90, height: 22, borderRadius: 999 }} />
                  <div className="sk" style={{ width: 70, height: 22, borderRadius: 999 }} />
                </div>
              </div>
            </div>

            <div className="prose" style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 24 }}>
              <div className="sk" style={{ width: 140, height: 20 }} />
              <div className="sk" style={{ width: '100%' }} />
              <div className="sk" style={{ width: '96%' }} />
              <div className="sk" style={{ width: '90%' }} />
              <div className="sk" style={{ width: '98%' }} />
              <div className="sk" style={{ width: '70%' }} />
            </div>
          </div>

          <aside className="evidence">
            <div className="ev-card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="sk" style={{ width: '50%', height: 18 }} />
              <div className="sk" style={{ width: '100%' }} />
              <div className="sk" style={{ width: '100%' }} />
              <div className="sk" style={{ width: '100%' }} />
            </div>
            <div className="ev-card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="sk" style={{ width: '60%' }} />
              <div className="sk" style={{ width: '40%' }} />
            </div>
          </aside>
        </div>
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

  const flatProfileSkills = new Set(
    (profile?.resume?.skillGroups ?? []).flatMap((group) => group.skills.map((skill) => skill.toLowerCase())),
  )
  const matchedSkills = new Set(
    (job.extractedRequirements?.requiredSkills ?? []).filter((skill) => flatProfileSkills.has(skill.toLowerCase())),
  )

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
                <a
                  href={job.normalizedUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="title-link"
                  title="View original posting"
                  aria-label="View original posting"
                >
                  <Icon name="open-outline" style={{ fontSize: 18 }} />
                </a>
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
                  {formatDate(job.postedAt)}
                </span>
              </div>
              <div className="fcard-meta" style={{ marginTop: 12 }}>
                {job.status === 'verified' ? (
                  <Pill tone="verified">Verified open</Pill>
                ) : (
                  <Pill tone="mono">{job.status}</Pill>
                )}
                {job.sourceId === 'teletalk-govt' && <Pill tone="govt">Government</Pill>}
                <Pill tone="mono">{job.sourceId}</Pill>
              </div>
            </div>
          </div>

          {job.verificationEvidence && (
            <div className="verify-strip">
              <div className="vstep">
                <span className="dot">
                  <Icon name="briefcase-outline" />
                </span>
                <div>
                  <b>Verification evidence</b>
                  <span>{formatDate(job.verifiedAt)}</span>
                </div>
              </div>
            </div>
          )}

          <div className="prose">
            <h2>Description</h2>
            <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(job.rawDescription) }} />

            {job.extractedRequirements && job.extractedRequirements.requiredSkills.length > 0 && (
              <>
                <h2>Required skills</h2>
                <div className="skills">
                  {job.extractedRequirements.requiredSkills.map((skill) => (
                    <span key={skill} className={`pill${matchedSkills.has(skill) ? ' hit' : ''}`}>
                      {skill}
                    </span>
                  ))}
                </div>
              </>
            )}

            {job.extractedRequirements && job.extractedRequirements.niceToHaveSkills.length > 0 && (
              <>
                <h2>Nice to have</h2>
                <div className="skills">
                  {job.extractedRequirements.niceToHaveSkills.map((skill) => (
                    <span key={skill} className="pill">
                      {skill}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        <aside className="evidence">
          {job.score !== null && job.scoreBreakdown && (
            <div className="ev-card" ref={scoreCardRef}>
              <div className="head">
                <div>
                  <div className="t">Match score</div>
                  <div className="v">{formatDate(job.scoredAt)}</div>
                </div>
                <ScoreRing score={job.score} size={56} strokeWidth={5} />
              </div>
              <div className="bars">
                {Object.entries(job.scoreBreakdown).map(([key, value]) => {
                  const k = key as keyof typeof SCORE_MAX
                  const pct = Math.round((value / SCORE_MAX[k]) * 100)
                  return (
                    <div className="bar-row" key={key}>
                      <span className="lbl">{SCORE_LABELS[k]}</span>
                      <div className="bar-track">
                        <div className="bar-fill" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="pct">
                        {value}/{SCORE_MAX[k]}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div className="ev-card">
            <div className="ev-kv">
              <div>
                <div className="t">Compensation</div>
                <div className="v">{formatSalary(job)}</div>
              </div>
              {job.extractedRequirements && (
                <div>
                  <div className="t">Work authorization</div>
                  <div className="v">
                    {{
                      any: 'Open to anyone',
                      citizen_only: 'Citizens/residents only',
                      visa_sponsorship_available: 'Visa sponsorship available',
                      unknown: 'Not specified',
                    }[job.extractedRequirements.workAuthRequirement]}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="ev-card">
            <div className="src-link">
              <span className="fav">{job.sourceId.slice(0, 2).toUpperCase()}</span>
              <div>
                <span>{job.company}</span>
                <small>via {job.sourceId}</small>
              </div>
            </div>
          </div>

          <div className="ev-card">
            <div className="ev-actions">
              <button
                type="button"
                className="btn btn-indigo"
                onClick={() => {
                  if (!isAuthenticated) {
                    navigate('/login', { state: { from: location.pathname } })
                    return
                  }
                  // Don't block on an incomplete profile — the drawer nudges the
                  // user to complete it for better results instead.
                  setDrawerOpen(true)
                }}
              >
                Apply
              </button>
              {isAdmin && (
                <>
                  <button type="button" className="btn btn-ghost" onClick={forceSync} disabled={syncBusy}>
                    {syncBusy ? 'Syncing…' : 'Force sync'}
                  </button>
                  {syncMessage && <p className="ev-sync-msg">{syncMessage}</p>}
                </>
              )}
            </div>
          </div>
        </aside>
      </div>

      {relatedJobs.length > 0 && (
        <div className="wrap related">
          <h2>Related roles</h2>
          <div className="jobs-grid">
            {relatedJobs.map((related) => (
              <Link to={`/jobs/${related._id}`} key={related._id} className="jobcard">
                <div className="top">
                  <div>
                    <div className="role">{related.title}</div>
                    <div className="co">{related.company}</div>
                  </div>
                  <ScoreRing score={related.score ?? 0} size={40} />
                </div>
                <div className="tags">
                  <Pill tone="verified">Verified</Pill>
                </div>
                <div className="foot">
                  <span className="src">{related.sourceId}</span>
                  <span className="apply">View role →</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      <ApplyDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        sourceId={job.sourceId}
        sourceJobId={job.sourceJobId}
        company={job.company}
        title={job.title}
        applyUrl={job.normalizedUrl}
        requiredSkills={job.extractedRequirements?.requiredSkills ?? []}
        profile={profile}
        onProfileChange={setProfile}
      />

      <Footer />
    </div>
  )
}
