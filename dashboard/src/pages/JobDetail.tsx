import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import DOMPurify from 'dompurify'
import { Briefcase, Building2, Calendar, MapPin, Wallet } from 'lucide-react'
import type { Job, Profile } from '@job-hunter/shared'
import { apiFetch } from '../api/client'
import { AppNav } from '../components/Nav'
import { FormError } from '../components/FormError'
import { ScoreRing } from '../components/ScoreRing'
import { Pill } from '../components/Pill'
import { LogoChip } from '../components/LogoChip'

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

type ApplicationState =
  | { phase: 'none' }
  | { phase: 'loading' }
  | {
      phase: 'loaded'
      application: { jobId: string; status: string; requiredAnswers: Array<{ answer: string | null }> }
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

  const jobId = job ? `${job.sourceId}:${job.sourceJobId}` : null

  function refreshApplication() {
    if (!jobId) return
    setAppState({ phase: 'loading' })
    apiFetch(`/applications/${jobId}`)
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
    refreshApplication()
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
      const res = await apiFetch(`/materials/${jobId}/generate`, { method: 'POST' })
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
    } finally {
      setActionBusy(false)
    }
  }

  async function runAutomation() {
    if (!jobId) return
    setActionBusy(true)
    setActionError(null)
    try {
      const res = await apiFetch(`/automation/${jobId}/run`, { method: 'POST' })
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
      const res = await apiFetch(`/applications/${jobId}/runs/${runNumber}/approve`, { method: 'POST' })
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
      const res = await apiFetch(`/automation/${jobId}/runs/${runNumber}/submit`, { method: 'POST' })
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

  const matchedSkills = new Set(
    (job.extractedRequirements?.requiredSkills ?? []).filter((skill) =>
      profile?.cvText ? profile.cvText.toLowerCase().includes(skill.toLowerCase()) : false
    )
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
            <div className="ev-card">
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
            <div className="ev-actions">
              <button type="button" className="btn btn-indigo" onClick={openDrawer}>
                Apply
              </button>
            </div>
          </div>
        </aside>
      </div>

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
                <div className="doc-preview">
                  <div className="dp-h">
                    <span>Status</span>
                    <span>{appState.application.status}</span>
                  </div>
                  {appState.latestRun ? (
                    <p>
                      Latest automation run #{appState.latestRun.runNumber}: {appState.latestRun.status}
                      {appState.latestRun.blockReason ? ` — ${appState.latestRun.blockReason}` : ''}
                      {appState.latestRun.manualApplyUrl ? (
                        <>
                          {' '}
                          <a href={appState.latestRun.manualApplyUrl} target="_blank" rel="noreferrer">
                            Apply manually →
                          </a>
                        </>
                      ) : null}
                    </p>
                  ) : (
                    <p>No automation run yet.</p>
                  )}
                </div>

                {materialsPreview && (
                  <div className="doc-preview">
                    <div className="dp-h">
                      <span>Cover letter (draft)</span>
                    </div>
                    <p style={{ whiteSpace: 'pre-wrap' }}>{materialsPreview}</p>
                  </div>
                )}

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
