import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import DOMPurify from 'dompurify'
import { Briefcase, Building2, Calendar, MapPin, Wallet } from 'lucide-react'
import type { Job, Profile } from '@job-hunter/shared'
import { apiFetch } from '../api/client'
import { gsap } from '../lib/gsap'
import { AppNav } from '../components/Nav'
import { FormError } from '../components/FormError'
import { ScoreRing } from '../components/ScoreRing'
import { Pill } from '../components/Pill'
import { LogoChip } from '../components/LogoChip'
import { materialFileName } from '../lib/filename'

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

// Automated apply drives a real headless browser and is only wired up for local
// development right now — gate it behind a localhost check so deployed builds
// show a "coming soon" placeholder instead of a non-functional tab.
const IS_LOCALHOST =
  typeof window !== 'undefined' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname)

const SCORE_LABELS = {
  workAuthFit: 'Work authorization',
  remoteFit: 'Remote fit',
  salaryFit: 'Compensation',
  skillMatch: 'Skills match',
  locationFit: 'Location',
} as const

type ApplicationState =
  | { phase: 'none' }
  | { phase: 'loading' }
  | {
      phase: 'loaded'
      application: { jobId: string; status: string }
      latestRun: { runNumber: number; status: string; blockReason: string | null; manualApplyUrl: string | null } | null
    }
  | { phase: 'error'; message: string }

export function JobDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [job, setJob] = useState<Job | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [appState, setAppState] = useState<ApplicationState>({ phase: 'none' })
  const [actionBusy, setActionBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [materialsPreview, setMaterialsPreview] = useState<string | null>(null)
  const [cvPreview, setCvPreview] = useState<string | null>(null)
  // Nothing is generated automatically — these flip true only when the user
  // clicks "Generate cover letter" / "Generate résumé", which is what reveals
  // (and, if needed, generates) each document.
  const [coverRequested, setCoverRequested] = useState(false)
  const [cvRequested, setCvRequested] = useState(false)
  // Independent busy flags so the cover-letter and résumé buttons act separately —
  // generating one neither disables nor shows a skeleton on the other.
  const [coverBusy, setCoverBusy] = useState(false)
  const [cvBusy, setCvBusy] = useState(false)
  const [activeTab, setActiveTab] = useState<'manual' | 'automated' | 'onsite'>('manual')
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle')
  const [cvCopyState, setCvCopyState] = useState<'idle' | 'copied'>('idle')
  const [skillBusy, setSkillBusy] = useState<string | null>(null)
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
    if (!drawerOpen) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setDrawerOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [drawerOpen])

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

  const jobId = job ? `${job.sourceId}:${job.sourceJobId}` : null

  function refreshApplication() {
    if (!jobId) return
    setAppState({ phase: 'loading' })
    apiFetch(`/applications/${encodeURIComponent(jobId)}`)
      .then(async (res) => {
        if (res.status === 404) {
          setAppState({ phase: 'none' })
          return
        }
        if (!res.ok) {
          setAppState({ phase: 'error', message: 'Failed to load application status.' })
          return
        }
        const body = await res.json()
        setAppState({ phase: 'loaded', application: body.application, latestRun: body.latestRun })
      })
      .catch(() => setAppState({ phase: 'error', message: 'Failed to load application status.' }))
  }

  function openDrawer() {
    setDrawerOpen(true)
    if (!jobId) return
    setAppState({ phase: 'loading' })
    apiFetch(`/applications/${encodeURIComponent(jobId)}`)
      .then(async (res) => {
        if (res.status === 404) {
          await startApplication()
          return
        }
        if (!res.ok) {
          setAppState({ phase: 'error', message: 'Failed to load application status.' })
          return
        }
        const body = await res.json()
        setAppState({ phase: 'loaded', application: body.application, latestRun: body.latestRun })
        // No automatic generation — the user generates cover letter / résumé on demand.
      })
      .catch(() => setAppState({ phase: 'error', message: 'Failed to load application status.' }))
  }

  // Runs one generation and returns the materials object (or null on failure).
  // The backend produces all docs in one call; each caller reads only its own.
  async function runGenerate(): Promise<{ coverLetter?: string; tailoredCv?: string } | null> {
    if (!jobId) return null
    const res = await apiFetch(`/materials/${encodeURIComponent(jobId)}/generate`, { method: 'POST' })
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      setActionError(body?.error ?? 'Materials generation is unavailable right now.')
      return null
    }
    const body = await res.json()
    if (body.status === 'deferred') {
      setActionError(`Materials deferred: ${body.reason}`)
      return null
    }
    return body.materials ?? null
  }

  // Cover-letter and résumé buttons act independently: each has its own busy flag
  // and skeleton, and only updates its own document.
  async function generateCoverLetter() {
    setCoverRequested(true)
    setMaterialsPreview(null) // clear so the skeleton shows
    setCoverBusy(true)
    setActionError(null)
    try {
      const m = await runGenerate()
      if (m) setMaterialsPreview(m.coverLetter ?? null)
    } finally {
      setCoverBusy(false)
    }
  }

  async function generateResume() {
    setCvRequested(true)
    setCvPreview(null) // clear so the skeleton shows
    setCvBusy(true)
    setActionError(null)
    try {
      const m = await runGenerate()
      if (m) setCvPreview(m.tailoredCv ?? null)
    } finally {
      setCvBusy(false)
    }
  }

  async function startApplication() {
    if (!job) return
    setActionBusy(true)
    setActionError(null)
    try {
      const res = await apiFetch('/applications', {
        method: 'POST',
        body: JSON.stringify({ sourceId: job.sourceId, sourceJobId: job.sourceJobId }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setActionError(body?.error ?? 'Failed to start application.')
        return
      }
      refreshApplication()
    } finally {
      setActionBusy(false)
    }
  }

  async function generateMaterials() {
    if (!jobId) return
    setActionBusy(true)
    setActionError(null)
    try {
      const res = await apiFetch(`/materials/${encodeURIComponent(jobId)}/generate`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setActionError(body?.error ?? 'Materials generation is unavailable right now.')
        return
      }
      const body = await res.json()
      if (body.status === 'deferred') {
        setActionError(`Materials deferred: ${body.reason}`)
        return
      }
      setMaterialsPreview(body.materials?.coverLetter ?? null)
      setCvPreview(body.materials?.tailoredCv ?? null)
    } finally {
      setActionBusy(false)
    }
  }

  async function addSkill(skill: string) {
    if (!profile) return
    setSkillBusy(skill)
    try {
      const skillGroups = profile.resume?.skillGroups ?? []
      const existingIndex = skillGroups.findIndex((group) => group.category === 'Additional skills')
      const nextSkillGroups =
        existingIndex === -1
          ? [...skillGroups, { category: 'Additional skills', skills: [skill] }]
          : skillGroups.map((group, index) =>
              index === existingIndex ? { ...group, skills: [...group.skills, skill] } : group,
            )
      const res = await apiFetch('/profile', {
        method: 'PUT',
        body: JSON.stringify({ resume: { ...profile.resume, skillGroups: nextSkillGroups } }),
      })
      if (!res.ok) {
        setActionError('Failed to add skill to your profile.')
        return
      }
      setProfile(await res.json())
    } finally {
      setSkillBusy(null)
    }
  }

  function copyCoverLetter() {
    if (!materialsPreview) return
    navigator.clipboard.writeText(materialsPreview).then(() => {
      setCopyState('copied')
      setTimeout(() => setCopyState('idle'), 1600)
    })
  }

  function copyCv() {
    if (!cvPreview) return
    navigator.clipboard.writeText(cvPreview).then(() => {
      setCvCopyState('copied')
      setTimeout(() => setCvCopyState('idle'), 1600)
    })
  }

  // Downloads a generated document (tailored CV or cover letter) for THIS job as a
  // PDF, named with the logged-in user's name + email. Generates once if missing.
  async function downloadDoc(docType: 'tailoredCv' | 'coverLetter', kind: 'cv' | 'cover') {
    if (!jobId) return
    setActionBusy(true)
    setActionError(null)
    try {
      const path = `/materials/${encodeURIComponent(jobId)}/export?doc=${docType}&format=pdf`
      let res = await apiFetch(path)
      if (res.status === 404) {
        // No materials yet — generate them, then retry the export once.
        await generateMaterials()
        res = await apiFetch(path)
      }
      if (!res.ok) {
        setActionError('Failed to prepare the document for download.')
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = materialFileName({
        fullName: profile?.resume?.fullName,
        email: profile?.email,
        kind,
        ext: 'pdf',
      })
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } finally {
      setActionBusy(false)
    }
  }

  async function runAutomation() {
    if (!jobId) return
    setActionBusy(true)
    setActionError(null)
    try {
      const res = await apiFetch(`/automation/${encodeURIComponent(jobId)}/run`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setActionError(body?.error ?? 'Failed to run automation.')
        return
      }
      refreshApplication()
    } finally {
      setActionBusy(false)
    }
  }

  async function approveRun(runNumber: number) {
    if (!jobId) return
    setActionBusy(true)
    setActionError(null)
    try {
      const res = await apiFetch(`/applications/${encodeURIComponent(jobId)}/runs/${runNumber}/approve`, { method: 'POST' })
      const body = await res.json().catch(() => null)
      if (!res.ok || !body?.approved) {
        setActionError(body?.reason ?? body?.error ?? 'Approval failed.')
        return
      }
      refreshApplication()
    } finally {
      setActionBusy(false)
    }
  }

  async function submitRun(runNumber: number) {
    if (!jobId) return
    setActionBusy(true)
    setActionError(null)
    try {
      const res = await apiFetch(`/automation/${encodeURIComponent(jobId)}/runs/${runNumber}/submit`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setActionError(body?.error ?? 'Submission failed.')
        return
      }
      refreshApplication()
    } finally {
      setActionBusy(false)
    }
  }

  if (!job && !error) {
    return (
      <div>
        <AppNav />
        <p className="wrap" style={{ marginTop: 24, color: 'var(--muted-text)' }}>
          Loading…
        </p>
      </div>
    )
  }

  if (error || !job) {
    return (
      <div>
        <AppNav />
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
  const missingSkills = (job.extractedRequirements?.requiredSkills ?? []).filter(
    (skill) => !flatProfileSkills.has(skill.toLowerCase()),
  )

  return (
    <div>
      <AppNav />
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
              <h1>{job.title}</h1>
              <div className="meta">
                <span>
                  <Building2 size={14} />
                  {job.company}
                </span>
                <span>
                  <MapPin size={14} />
                  {job.location ?? 'Location unknown'}
                </span>
                <span>
                  <Wallet size={14} />
                  {formatSalary(job)}
                </span>
                <span>
                  <Calendar size={14} />
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
                  <Briefcase size={12} />
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

          <a href={job.normalizedUrl} target="_blank" rel="noreferrer" className="btn btn-ghost" style={{ marginTop: 24 }}>
            View original posting →
          </a>
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
              <button type="button" className="btn btn-indigo" onClick={openDrawer}>
                Apply
              </button>
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

      <div className={`drawer${drawerOpen ? ' open' : ''}`} role="dialog" aria-hidden={!drawerOpen}>
        <div className="scrim" onClick={() => setDrawerOpen(false)} />
        <div className="panel">
          <div className="p-head">
            <h3>Apply to {job.company}</h3>
            <button type="button" className="x" aria-label="Close" onClick={() => setDrawerOpen(false)}>
              ×
            </button>
          </div>
          <div className="p-body">
            {actionError && <FormError message={actionError} />}

            {appState.phase === 'loading' && <p style={{ color: 'var(--muted-text)' }}>Loading…</p>}

            {appState.phase === 'none' && (
              <>
                <p style={{ color: 'var(--fg-2)', fontSize: 14 }}>
                  No application started for this job yet. Starting one creates a draft you fully control —
                  nothing is submitted until you explicitly confirm later.
                </p>
                <button type="button" className="btn btn-indigo" disabled={actionBusy} onClick={startApplication}>
                  Start application
                </button>
              </>
            )}

            {appState.phase === 'loaded' && (
              <>
                <div className="tab-row">
                  <button
                    type="button"
                    className={`btn ${activeTab === 'manual' ? 'btn-indigo' : 'btn-ghost'}`}
                    onClick={() => setActiveTab('manual')}
                  >
                    Prepare manually
                  </button>
                  <button
                    type="button"
                    className={`btn ${activeTab === 'automated' ? 'btn-indigo' : 'btn-ghost'}`}
                    onClick={() => setActiveTab('automated')}
                  >
                    Automated apply
                  </button>
                  <button
                    type="button"
                    className={`btn ${activeTab === 'onsite' ? 'btn-indigo' : 'btn-ghost'}`}
                    onClick={() => setActiveTab('onsite')}
                  >
                    Apply on site
                  </button>
                </div>

                {activeTab === 'manual' && (
                  <>
                    {/* Nothing is generated until the user clicks. The buttons stay
                        available so each document can be regenerated on demand. */}
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      <button type="button" className="btn btn-indigo" onClick={generateCoverLetter} disabled={coverBusy}>
                        {coverBusy
                          ? 'Generating…'
                          : materialsPreview
                            ? 'Regenerate cover letter'
                            : 'Generate cover letter'}
                      </button>
                      <button type="button" className="btn btn-indigo" onClick={generateResume} disabled={cvBusy}>
                        {cvBusy ? 'Generating…' : cvPreview ? 'Regenerate résumé (ATS)' : 'Generate résumé (ATS)'}
                      </button>
                    </div>

                    {coverBusy && (
                      <div className="doc-preview" aria-hidden="true">
                        <div className="dp-h">
                          <span>Cover letter (draft)</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                          <div className="sk" style={{ width: '38%' }} />
                          <div className="sk" style={{ width: '100%' }} />
                          <div className="sk" style={{ width: '94%' }} />
                          <div className="sk" style={{ width: '97%' }} />
                          <div className="sk" style={{ width: '62%' }} />
                          <div className="sk" style={{ width: '100%', marginTop: 8 }} />
                          <div className="sk" style={{ width: '90%' }} />
                          <div className="sk" style={{ width: '45%' }} />
                        </div>
                      </div>
                    )}

                    {coverRequested && materialsPreview && !coverBusy && (
                      <div className="doc-preview">
                        <div className="dp-h">
                          <span>Cover letter (draft)</span>
                          <button type="button" className={`copy-btn${copyState === 'copied' ? ' ok' : ''}`} onClick={copyCoverLetter}>
                            {copyState === 'copied' ? 'Copied' : 'Copy'}
                          </button>
                        </div>
                        <p style={{ whiteSpace: 'pre-wrap' }}>{materialsPreview}</p>
                        <button
                          type="button"
                          className="btn btn-indigo"
                          onClick={() => downloadDoc('coverLetter', 'cover')}
                          disabled={actionBusy}
                          style={{ marginTop: 14 }}
                        >
                          {actionBusy ? 'Preparing…' : 'Download cover letter (PDF)'}
                        </button>
                      </div>
                    )}

                    {cvBusy && (
                      <div className="doc-preview" aria-hidden="true">
                        <div className="dp-h">
                          <span>Tailored CV</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                          <div className="sk" style={{ width: '42%' }} />
                          <div className="sk" style={{ width: '70%' }} />
                          <div className="sk" style={{ width: '30%', marginTop: 8 }} />
                          <div className="sk" style={{ width: '100%' }} />
                          <div className="sk" style={{ width: '95%' }} />
                          <div className="sk" style={{ width: '88%' }} />
                          <div className="sk" style={{ width: '34%', marginTop: 8 }} />
                          <div className="sk" style={{ width: '98%' }} />
                          <div className="sk" style={{ width: '91%' }} />
                        </div>
                      </div>
                    )}

                    {cvRequested && cvPreview && !cvBusy && (
                      <div className="doc-preview">
                        <div className="dp-h">
                          <span>Tailored CV (ATS-optimized)</span>
                          <button type="button" className={`copy-btn${cvCopyState === 'copied' ? ' ok' : ''}`} onClick={copyCv}>
                            {cvCopyState === 'copied' ? 'Copied' : 'Copy'}
                          </button>
                        </div>
                        <p style={{ whiteSpace: 'pre-wrap', maxHeight: 360, overflowY: 'auto' }}>{cvPreview}</p>
                        <button
                          type="button"
                          className="btn btn-indigo"
                          onClick={() => downloadDoc('tailoredCv', 'cv')}
                          disabled={actionBusy}
                          style={{ marginTop: 14 }}
                        >
                          {actionBusy ? 'Preparing…' : 'Download tailored CV (PDF)'}
                        </button>
                      </div>
                    )}

                    {missingSkills.length > 0 && (
                      <div>
                        <div className="dp-h">
                          <span>Missing skills for this role</span>
                        </div>
                        <div className="missing">
                          {missingSkills.map((skill) => (
                            <div className="mrow" key={skill}>
                              <b>{skill}</b>
                              <button
                                type="button"
                                className="btn btn-ghost"
                                disabled={skillBusy === skill}
                                onClick={() => addSkill(skill)}
                              >
                                {skillBusy === skill ? 'Adding…' : 'Add'}
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                  </>
                )}

                {activeTab === 'automated' && !IS_LOCALHOST ? (
                  <div className="doc-preview coming-soon">
                    <span className="cs-badge">Coming soon</span>
                    <h4>Automated apply is on its way</h4>
                    <p style={{ margin: 0 }}>
                      We're putting the finishing touches on one-click automated applications. For now,
                      use <b>Prepare manually</b> to grab your tailored cover letter and CV.
                    </p>
                  </div>
                ) : ""}

                {activeTab === 'automated' && IS_LOCALHOST ? (
                  <>
                    <div className="doc-preview">
                      <div className="dp-h">
                        <span>Status</span>
                        <span>{appState.application.status}</span>
                      </div>
                      {appState.latestRun ? (
                        <div className="run-status">
                          <div className="run-line">
                            <span>Automation run #{appState.latestRun.runNumber}</span>
                            <Pill tone={appState.latestRun.status === 'blocked' ? 'govt' : 'mono'}>
                              {appState.latestRun.status.replace(/_/g, ' ')}
                            </Pill>
                          </div>
                          {appState.latestRun.blockReason && (
                            <div className="run-reason">
                              <div className="dp-h">
                                <span>Reason</span>
                              </div>
                              <p style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>
                                {appState.latestRun.blockReason}
                              </p>
                            </div>
                          )}
                          {appState.latestRun.manualApplyUrl && (
                            <a
                              href={appState.latestRun.manualApplyUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="btn btn-ghost"
                            >
                              Apply manually →
                            </a>
                          )}
                        </div>
                      ) : (
                        <p>No automation run yet.</p>
                      )}
                    </div>

                    {appState.application.status === 'draft' && !appState.latestRun && (
                      <button type="button" className="btn btn-ghost" disabled={actionBusy} onClick={generateMaterials}>
                        Generate materials
                      </button>
                    )}

                    {appState.application.status === 'draft' && (
                      <button type="button" className="btn btn-ghost" disabled={actionBusy} onClick={runAutomation}>
                        Run automation
                      </button>
                    )}

                    {appState.latestRun?.status === 'ready_for_approval' && (
                      <button
                        type="button"
                        className="btn-confirm"
                        disabled={actionBusy}
                        onClick={() => approveRun(appState.latestRun!.runNumber)}
                      >
                        Review and confirm
                      </button>
                    )}

                    {appState.latestRun?.status === 'approved' && (
                      <button
                        type="button"
                        className="btn-confirm"
                        disabled={actionBusy}
                        onClick={() => submitRun(appState.latestRun!.runNumber)}
                      >
                        Submit application
                      </button>
                    )}
                  </>
                ) : ""}

                {activeTab === 'onsite' && (
                  <>
                    <p style={{ color: 'var(--fg-2)', fontSize: 14 }}>
                      Apply directly on the original job posting. This opens the employer's site in a new tab so you
                      can complete the application there yourself.
                    </p>
                    <a
                      href={job.normalizedUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="btn btn-indigo"
                    >
                      Apply on site →
                    </a>
                  </>
                )}
              </>
            )}

            {appState.phase === 'error' && <FormError message={appState.message} />}
          </div>
          <div className="p-foot">
            <p className="fine">Nothing is ever submitted without your explicit confirmation.</p>
          </div>
        </div>
      </div>
    </div>
  )
}
