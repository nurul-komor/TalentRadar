import { Icon } from './Icon'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Profile } from '@job-hunter/shared'
import { apiFetch } from '../api/client'
import { FormError } from './FormError'
import { Pill } from './Pill'
import { materialFileName } from '../lib/filename'
import { DownloadMenu, type DownloadFormat } from './DownloadMenu'

// The generated materials are only as good as the profile behind them, so when
// key resume inputs are thin we nudge (never block) the user to fill them in.
function isProfileThin(profile: Profile | null): boolean {
  if (!profile) return true
  const resume = profile.resume
  return (
    profile.cvText == null ||
    !resume?.fullName?.trim() ||
    (resume?.experience.length ?? 0) === 0 ||
    (resume?.skillGroups.some((group) => group.skills.length > 0) ?? false) === false
  )
}

// Automated apply drives a real headless browser and is only wired up for local
// development right now — gate it behind a localhost check so deployed builds
// show a "coming soon" placeholder instead of a non-functional tab.
const IS_LOCALHOST =
  typeof window !== 'undefined' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname)

// Where to send the user for the application that conflicted with this one. A
// user-added job has its own detail page; anything else (a discovered job, or an
// unknown id) falls back to the applications list, which always resolves.
function existingApplicationHref(existingJobId: string | null): string {
  if (existingJobId?.startsWith('userJob:')) {
    return `/my-jobs/${existingJobId.slice('userJob:'.length)}`
  }
  return '/applications'
}

type ApplicationState =
  | { phase: 'none' }
  | { phase: 'loading' }
  | {
      phase: 'loaded'
      application: {
        jobId: string
        status: string
        // Questions the automation couldn't infer (unlabeled fields, option
        // groups); surfaced in the Automated tab so the user sees what's pending.
        requiredAnswers?: { question: string; answer: string | null }[]
      }
      latestRun: {
        runNumber: number
        status: string
        blockReason: string | null
        manualApplyUrl: string | null
        // What the headless run auto-filled on the employer form, shown as a
        // reviewable preview before the user approves/submits.
        filledFields?: Record<string, string> | null
      } | null
    }
  | { phase: 'error'; message: string }
  // The job duplicates a role the user already has an application for (same
  // company/title within the dedupe window). Not an error — a clean dead-end
  // state that points them at the existing application instead of hanging.
  | { phase: 'duplicate'; message: string; existingJobId: string | null }

export interface ApplyDrawerProps {
  open: boolean
  onClose: () => void
  // Job identity. jobId is `${sourceId}:${sourceJobId}` — discovered jobs pass
  // their real source key; user-added jobs pass sourceId `userJob` and their _id.
  sourceId: string
  sourceJobId: string
  company: string
  title: string
  // Where "Apply on site" sends the user. Null for a user job with no link.
  applyUrl: string | null
  // The role's extracted required skills, used for the live missing-skills diff
  // before a résumé is generated. Empty for user jobs (no extraction).
  requiredSkills?: string[]
  // The signed-in profile, used to diff missing skills and name downloaded PDFs.
  profile: Profile | null
  // Called after the drawer mutates the profile (adding a skill), so the parent
  // stays in sync without refetching.
  onProfileChange: (profile: Profile) => void
}

export function ApplyDrawer({
  open,
  onClose,
  sourceId,
  sourceJobId,
  company,
  title,
  applyUrl,
  requiredSkills = [],
  profile,
  onProfileChange,
}: ApplyDrawerProps) {
  const jobId = `${sourceId}:${sourceJobId}`

  const [appState, setAppState] = useState<ApplicationState>({ phase: 'none' })
  const [actionBusy, setActionBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [materialsPreview, setMaterialsPreview] = useState<string | null>(null)
  const [cvPreview, setCvPreview] = useState<string | null>(null)
  const [unmetRequirements, setUnmetRequirements] = useState<string[]>([])
  // Persisted skill-gap snapshot from the latest generation. Unlike the live
  // `missingSkills` below (recomputed from the current profile), this reflects
  // what was missing when the résumé was generated — and survives those skills
  // being auto-added to the profile, so the "review later" list stays intact.
  const [generatedMissingSkills, setGeneratedMissingSkills] = useState<string[]>([])
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
  // Persist state for the explicit "Save to my profile" action. Stays 'saved'
  // until the user regenerates that document, since a regenerate makes the
  // on-screen draft differ from what was saved.
  const [coverSaveState, setCoverSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [cvSaveState, setCvSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [skillBusy, setSkillBusy] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  // Load (or start) the application whenever the drawer opens for a job. A 404
  // means no application exists yet — start one, matching the discovered-job flow.
  useEffect(() => {
    if (!open) return
    void loadExistingMaterials()
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
      })
      .catch(() => setAppState({ phase: 'error', message: 'Failed to load application status.' }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, jobId])

  function refreshApplication() {
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

  // Load the most recent previously generated materials for this job so the
  // drawer shows them immediately instead of a blank state. Also hydrates the
  // "Saved to profile" indicators from the user's saved record.
  async function loadExistingMaterials() {
    try {
      const res = await apiFetch(`/materials/${encodeURIComponent(jobId)}`)
      if (res.ok) {
        const m = await res.json()
        if (m.coverLetter) {
          setMaterialsPreview(m.coverLetter)
          setCoverRequested(true)
        }
        if (m.tailoredCv) {
          setCvPreview(m.tailoredCv)
          setCvRequested(true)
          setUnmetRequirements(m.unmetRequirements ?? [])
          setGeneratedMissingSkills(m.missingSkills ?? [])
        }
      }
      // A 404 just means nothing generated yet — leave the empty state as-is.
    } catch {
      // Network hiccup: fall back to the empty state rather than erroring the drawer.
    }

    try {
      const savedRes = await apiFetch(`/materials/${encodeURIComponent(jobId)}/saved`)
      if (savedRes.ok) {
        const saved = await savedRes.json()
        if (saved.coverLetter) setCoverSaveState('saved')
        if (saved.tailoredCv) setCvSaveState('saved')
      }
    } catch {
      // Ignore — the save indicators simply stay in their default state.
    }
  }

  // Runs one generation and returns the materials object (or null on failure).
  // The backend produces all docs in one call; each caller reads only its own.
  async function runGenerate(): Promise<{
    coverLetter?: string
    tailoredCv?: string
    unmetRequirements?: string[]
    missingSkills?: string[]
  } | null> {
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
    setCoverSaveState('idle') // a fresh draft is no longer the saved one
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
    setCvSaveState('idle') // a fresh draft is no longer the saved one
    setCvBusy(true)
    setActionError(null)
    try {
      const m = await runGenerate()
      if (m) {
        setCvPreview(m.tailoredCv ?? null)
        setUnmetRequirements(m.unmetRequirements ?? [])
        setGeneratedMissingSkills(m.missingSkills ?? [])
      }
    } finally {
      setCvBusy(false)
    }
  }

  async function startApplication() {
    setActionBusy(true)
    setActionError(null)
    try {
      const res = await apiFetch('/applications', {
        method: 'POST',
        body: JSON.stringify({ sourceId, sourceJobId }),
      })
      if (res.ok) {
        refreshApplication()
        return
      }
      // A 409 means an application for this job already exists. Two cases:
      //  1. A benign double-start (React StrictMode double-invokes effects in
      //     dev, or a rapid reopen) racing the create — re-check for THIS job
      //     and, if it now exists, just load it.
      //  2. A same company/title duplicate under a DIFFERENT jobId (the user
      //     added the same role twice). There's no application for this jobId to
      //     load, so surface a clean "already applied" state (not a stuck
      //     spinner) that links back to the existing application.
      if (res.status === 409) {
        const check = await apiFetch(`/applications/${encodeURIComponent(jobId)}`)
        if (check.ok) {
          const body = await check.json()
          setAppState({ phase: 'loaded', application: body.application, latestRun: body.latestRun })
          return
        }
        const body = await res.json().catch(() => null)
        setAppState({
          phase: 'duplicate',
          message: body?.error ?? 'You already have an application for this role.',
          existingJobId: body?.existingJobId ?? null,
        })
        return
      }
      const body = await res.json().catch(() => null)
      setAppState({ phase: 'error', message: body?.error ?? 'Failed to start application.' })
    } finally {
      setActionBusy(false)
    }
  }

  async function generateMaterials() {
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
      setUnmetRequirements(body.materials?.unmetRequirements ?? [])
      setGeneratedMissingSkills(body.materials?.missingSkills ?? [])
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
      onProfileChange(await res.json())
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

  // Save the generated document under the logged-in user's profile, attached to
  // this job post. Stores exactly the draft on screen; does NOT touch the base
  // profile résumé. Saving again for the same job overwrites the prior copy.
  async function saveMaterial(kind: 'cover' | 'cv') {
    const text = kind === 'cover' ? materialsPreview : cvPreview
    if (!text) return
    const setState = kind === 'cover' ? setCoverSaveState : setCvSaveState
    setState('saving')
    setActionError(null)
    try {
      const res = await apiFetch(`/materials/${encodeURIComponent(jobId)}/save`, {
        method: 'POST',
        body: JSON.stringify(kind === 'cover' ? { coverLetter: text } : { tailoredCv: text }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setActionError(body?.error ?? 'Failed to save to your profile.')
        setState('idle')
        return
      }
      setState('saved')
    } catch {
      setActionError('Failed to save to your profile.')
      setState('idle')
    }
  }

  // Downloads a generated document (tailored CV or cover letter) for THIS job in the
  // format the user picked, named with the logged-in user's name + email. Generates
  // once if missing.
  async function downloadDoc(
    docType: 'tailoredCv' | 'coverLetter',
    kind: 'cv' | 'cover',
    format: DownloadFormat
  ) {
    setActionBusy(true)
    setActionError(null)
    try {
      // Cache-bust so a regenerated document isn't masked by a stale cached download.
      const path = `/materials/${encodeURIComponent(jobId)}/export?doc=${docType}&format=${format}&t=${Date.now()}`
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
        company,
        kind,
        ext: format,
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

  const flatProfileSkills = new Set(
    (profile?.resume?.skillGroups ?? []).flatMap((group) => group.skills.map((skill) => skill.toLowerCase())),
  )
  const missingSkills = requiredSkills.filter((skill) => !flatProfileSkills.has(skill.toLowerCase()))
  // Once a résumé is generated the missing skills are snapshotted and auto-added
  // to the profile, so the live diff above goes empty. Show the saved snapshot
  // then (for later review); fall back to the live diff before first generation.
  const missingSkillsAreSaved = generatedMissingSkills.length > 0
  const reviewMissingSkills = missingSkillsAreSaved ? generatedMissingSkills : missingSkills

  return (
    <div className={`drawer${open ? ' open' : ''}`} role="dialog" aria-hidden={!open}>
      <div className="scrim" onClick={onClose} />
      <div className="panel">
        <div className="p-head">
          <div>
            <h3>Apply to {company}</h3>
            <p className="p-sub">{title}</p>
          </div>
          <button type="button" className="x" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="p-body">
          {actionError && <FormError message={actionError} />}

          {appState.phase === 'loading' && <p style={{ color: 'var(--muted-text)' }}>Loading…</p>}

          {appState.phase === 'duplicate' && (
            <div className="auto-reveal rounded-xl border border-border bg-card p-6 text-center">
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-cyan/15 text-cyan">
                <Icon name="checkmark-outline" style={{ fontSize: 24 }} />
              </div>
              <h4 className="mt-3 text-base font-semibold text-foreground">You've already applied to this role</h4>
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                There's already an application for <b className="text-foreground">{company}</b> — {title}. To
                avoid duplicate applications we didn't start a new one. You can manage the existing
                application below.
              </p>
              <Link
                to={existingApplicationHref(appState.existingJobId)}
                onClick={onClose}
                className="mt-4 inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-all hover:-translate-y-0.5 hover:brightness-110 active:translate-y-0"
              >
                <Icon name="briefcase-outline" style={{ fontSize: 15 }} />
                {appState.existingJobId?.startsWith('userJob:')
                  ? 'Go to the existing job'
                  : 'View your applications'}
              </Link>
            </div>
          )}

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
              <div className="tab-row" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'manual'}
                  className={`tab${activeTab === 'manual' ? ' active' : ''}`}
                  onClick={() => setActiveTab('manual')}
                >
                  <Icon name="create-outline" /> Prepare
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'automated'}
                  className={`tab${activeTab === 'automated' ? ' active' : ''}`}
                  onClick={() => setActiveTab('automated')}
                >
                  <Icon name="hardware-chip-outline" /> Automated
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'onsite'}
                  className={`tab${activeTab === 'onsite' ? ' active' : ''}`}
                  onClick={() => setActiveTab('onsite')}
                >
                  <Icon name="globe-outline" /> On site
                </button>
              </div>

              {activeTab === 'manual' && (
                <>
                  <p className="drawer-help">
                    Generate AI-tailored application materials for this role, then copy them or download as PDFs.
                  </p>

                  {isProfileThin(profile) && (
                    <div className="mb-3 flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
                      <Icon
                        name="bulb-outline"
                        style={{ color: 'var(--primary)', fontSize: 18, flex: 'none', marginTop: 2 }}
                      />
                      <div className="text-sm">
                        <p className="font-medium text-foreground">Complete your profile for better results</p>
                        <p className="mt-0.5 text-muted-foreground">
                          You can generate materials now, but a complete profile — CV, work experience, and
                          skills — produces a noticeably stronger tailored résumé and cover letter.
                        </p>
                        <Link
                          to="/onboarding"
                          className="mt-1.5 inline-flex items-center gap-1 font-medium text-primary hover:underline"
                        >
                          Complete profile
                          <Icon name="arrow-forward-outline" style={{ fontSize: 13 }} />
                        </Link>
                      </div>
                    </div>
                  )}

                  {/* Nothing is generated until the user clicks. The cards stay
                      available so each document can be regenerated on demand. */}
                  <div className="gen-grid">
                    <button type="button" className="gen-card" onClick={generateCoverLetter} disabled={coverBusy}>
                      <span className="gc-icon">
                        <Icon name="sparkles-outline" />
                      </span>
                      <span className="gc-title">
                        {coverBusy
                          ? 'Generating…'
                          : materialsPreview
                            ? 'Regenerate cover letter'
                            : 'Cover letter'}
                      </span>
                      <span className="gc-sub">Personalized to this job posting</span>
                    </button>
                    <button type="button" className="gen-card" onClick={generateResume} disabled={cvBusy}>
                      <span className="gc-icon">
                        <Icon name="document-text-outline" />
                      </span>
                      <span className="gc-title">
                        {cvBusy ? 'Generating…' : cvPreview ? 'Regenerate résumé' : 'Résumé (ATS)'}
                      </span>
                      <span className="gc-sub">Optimized to pass ATS screening</span>
                    </button>
                  </div>

                  {!coverRequested && !cvRequested && !coverBusy && !cvBusy && (
                    <div className="empty-hint">
                      <Icon name="document-outline" />
                      <span>Nothing generated yet — pick a document above to get started.</span>
                    </div>
                  )}

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
                          {copyState === 'copied' ? (
                            <Icon name="checkmark-outline" style={{ fontSize: 14 }} />
                          ) : (
                            <Icon name="copy-outline" style={{ fontSize: 14 }} />
                          )}
                          {copyState === 'copied' ? 'Copied' : 'Copy'}
                        </button>
                      </div>
                      <p style={{ whiteSpace: 'pre-wrap' }}>{materialsPreview}</p>
                      <div className="doc-actions" style={{ marginTop: 14 }}>
                        <DownloadMenu
                          label="Download cover letter"
                          busy={actionBusy}
                          onSelect={(format) => downloadDoc('coverLetter', 'cover', format)}
                        />
                        <button
                          type="button"
                          className={`btn btn-ghost${coverSaveState === 'saved' ? ' ok' : ''}`}
                          onClick={() => saveMaterial('cover')}
                          disabled={coverSaveState !== 'idle'}
                        >
                          {coverSaveState === 'saved' ? (
                            <Icon name="checkmark-outline" />
                          ) : (
                            <Icon name="save-outline" />
                          )}
                          {coverSaveState === 'saving'
                            ? 'Saving…'
                            : coverSaveState === 'saved'
                              ? 'Saved to profile'
                              : 'Save to my profile'}
                        </button>
                      </div>
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
                          {cvCopyState === 'copied' ? (
                            <Icon name="checkmark-outline" style={{ fontSize: 14 }} />
                          ) : (
                            <Icon name="copy-outline" style={{ fontSize: 14 }} />
                          )}
                          {cvCopyState === 'copied' ? 'Copied' : 'Copy'}
                        </button>
                      </div>
                      <p style={{ whiteSpace: 'pre-wrap', maxHeight: 360, overflowY: 'auto' }}>{cvPreview}</p>
                      <div className="doc-actions" style={{ marginTop: 14 }}>
                        <DownloadMenu
                          label="Download tailored CV"
                          busy={actionBusy}
                          onSelect={(format) => downloadDoc('tailoredCv', 'cv', format)}
                        />
                        <button
                          type="button"
                          className={`btn btn-ghost${cvSaveState === 'saved' ? ' ok' : ''}`}
                          onClick={() => saveMaterial('cv')}
                          disabled={cvSaveState !== 'idle'}
                        >
                          {cvSaveState === 'saved' ? (
                            <Icon name="checkmark-outline" />
                          ) : (
                            <Icon name="save-outline" />
                          )}
                          {cvSaveState === 'saving'
                            ? 'Saving…'
                            : cvSaveState === 'saved'
                              ? 'Saved to profile'
                              : 'Save to my profile'}
                        </button>
                      </div>
                      {unmetRequirements.length > 0 && (
                        <div style={{ marginTop: 14 }}>
                          <div className="dp-h">
                            <span>Unmet requirements</span>
                          </div>
                          <ul style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13.5 }}>
                            {unmetRequirements.map((requirement, index) => (
                              <li key={index}>{requirement}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}

                  {reviewMissingSkills.length > 0 && (
                    <div>
                      <div className="dp-h">
                        <span>Missing skills for this role</span>
                      </div>
                      {missingSkillsAreSaved && (
                        <p style={{ margin: '4px 0 8px', fontSize: 13, opacity: 0.75 }}>
                          Saved with this application so you can brush up before interviews. Your tailored
                          résumé already lists these under Skills; your profile is left unchanged.
                        </p>
                      )}
                      <div className="missing">
                        {reviewMissingSkills.map((skill) => (
                          <div className="mrow" key={skill}>
                            <b>{skill}</b>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              disabled={skillBusy === skill}
                              onClick={() => addSkill(skill)}
                            >
                              {skillBusy === skill ? 'Adding…' : 'Add to profile'}
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
                <div className="flex flex-col gap-3">
                  {/* Submission result — the payoff view after Submit succeeds or fails. */}
                  {(appState.latestRun?.status === 'submitted' || appState.application.status === 'submitted') && (
                    <div className="auto-reveal relative overflow-hidden rounded-xl border border-cyan/30 bg-cyan/5 p-5 text-center">
                      <div className="auto-result-icon ok relative mx-auto grid h-12 w-12 place-items-center rounded-full bg-cyan/15 text-cyan">
                        <Icon name="checkmark-outline" style={{ fontSize: 26 }} />
                      </div>
                      <h4 className="mt-3 text-base font-semibold text-foreground">Application submitted</h4>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Your application to <b className="text-foreground">{company}</b> was sent successfully.
                      </p>
                    </div>
                  )}
                  {(appState.latestRun?.status === 'failed' || appState.application.status === 'failed') && (
                    <div className="auto-reveal rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-center">
                      <div className="auto-result-icon mx-auto grid h-12 w-12 place-items-center rounded-full bg-destructive/15 text-destructive">
                        <Icon name="alert-circle-outline" style={{ fontSize: 26 }} />
                      </div>
                      <h4 className="mt-3 text-base font-semibold text-foreground">Submission didn't go through</h4>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {appState.latestRun?.blockReason ?? 'The employer form rejected the submission. Try again or apply manually.'}
                      </p>
                    </div>
                  )}

                  {/* Status + automation run */}
                  <div className="auto-reveal rounded-xl border border-border bg-card p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">Status</span>
                      <Pill tone="mono">{appState.application.status}</Pill>
                    </div>
                    {appState.latestRun ? (
                      <div className="mt-3 flex flex-col gap-3 border-t border-border pt-3">
                        <div className="flex items-center justify-between">
                          <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                            <Icon name="hardware-chip-outline" style={{ fontSize: 16 }} />
                            Automation run #{appState.latestRun.runNumber}
                          </span>
                          <Pill tone={appState.latestRun.status === 'blocked' ? 'govt' : 'mono'}>
                            {appState.latestRun.status.replace(/_/g, ' ')}
                          </Pill>
                        </div>
                        {appState.latestRun.blockReason && appState.latestRun.status !== 'failed' && (
                          <div className="rounded-lg border border-border bg-muted/40 p-3">
                            <span className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">Reason</span>
                            <p className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground">
                              {appState.latestRun.blockReason}
                            </p>
                          </div>
                        )}
                        {appState.latestRun.manualApplyUrl && (
                          <a
                            href={appState.latestRun.manualApplyUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex w-fit items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-all hover:-translate-y-0.5 hover:bg-muted"
                          >
                            <Icon name="open-outline" style={{ fontSize: 15 }} />
                            Apply manually
                          </a>
                        )}
                      </div>
                    ) : (
                      <p className="mt-2 text-sm text-muted-foreground">No automation run yet.</p>
                    )}
                  </div>

                  {/* What the automation auto-filled on the employer form */}
                  {appState.latestRun?.filledFields && Object.keys(appState.latestRun.filledFields).length > 0 && (
                    <div className="auto-reveal rounded-xl border border-border bg-card p-4">
                      <div className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
                        <Icon name="list-outline" style={{ fontSize: 15 }} />
                        Auto-filled fields
                        <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                          {Object.keys(appState.latestRun.filledFields).length}
                        </span>
                      </div>
                      <dl className="mt-3 max-h-56 space-y-2 overflow-y-auto pr-1">
                        {Object.entries(appState.latestRun.filledFields).map(([field, value]) => (
                          <div key={field} className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.6fr)] gap-3 text-sm">
                            <dt className="truncate font-medium text-muted-foreground" title={field}>{field}</dt>
                            <dd className="break-words text-foreground">{value}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  )}

                  {/* Questions the automation couldn't infer — the user's to fill in */}
                  {appState.application.requiredAnswers && appState.application.requiredAnswers.length > 0 && (
                    <div className="auto-reveal rounded-xl border border-border bg-card p-4">
                      <div className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
                        <Icon name="clipboard-outline" style={{ fontSize: 15 }} />
                        Application questions
                      </div>
                      <ul className="mt-3 flex flex-col gap-3">
                        {appState.application.requiredAnswers.map((qa, index) => (
                          <li key={index} className="rounded-lg border border-border bg-muted/30 p-3">
                            <p className="text-sm font-medium text-foreground">{qa.question}</p>
                            {qa.answer ? (
                              <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{qa.answer}</p>
                            ) : (
                              <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2 py-0.5 text-[12px] font-medium text-amber-600 dark:text-amber-400">
                                <Icon name="alert-circle-outline" style={{ fontSize: 13 }} />
                                Needs your input
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Generated materials used for this application */}
                  {materialsPreview && (
                    <div className="auto-reveal rounded-xl border border-border bg-card p-4">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
                          <Icon name="sparkles-outline" style={{ fontSize: 15 }} />
                          Cover letter
                        </span>
                        <button
                          type="button"
                          className={`inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[12px] font-medium transition-colors ${copyState === 'copied' ? 'text-cyan' : 'text-muted-foreground hover:text-foreground'}`}
                          onClick={copyCoverLetter}
                        >
                          <Icon name={copyState === 'copied' ? 'checkmark-outline' : 'copy-outline'} style={{ fontSize: 13 }} />
                          {copyState === 'copied' ? 'Copied' : 'Copy'}
                        </button>
                      </div>
                      <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap text-sm text-foreground">{materialsPreview}</p>
                    </div>
                  )}
                  {cvPreview && (
                    <div className="auto-reveal rounded-xl border border-border bg-card p-4">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
                          <Icon name="document-text-outline" style={{ fontSize: 15 }} />
                          Tailored CV (ATS)
                        </span>
                        <button
                          type="button"
                          className={`inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[12px] font-medium transition-colors ${cvCopyState === 'copied' ? 'text-cyan' : 'text-muted-foreground hover:text-foreground'}`}
                          onClick={copyCv}
                        >
                          <Icon name={cvCopyState === 'copied' ? 'checkmark-outline' : 'copy-outline'} style={{ fontSize: 13 }} />
                          {cvCopyState === 'copied' ? 'Copied' : 'Copy'}
                        </button>
                      </div>
                      <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap text-sm text-foreground">{cvPreview}</p>
                      {unmetRequirements.length > 0 && (
                        <div className="mt-3 border-t border-border pt-3">
                          <span className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">Unmet requirements</span>
                          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[13.5px] text-foreground">
                            {unmetRequirements.map((requirement, index) => (
                              <li key={index}>{requirement}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                  {reviewMissingSkills.length > 0 && (
                    <div className="auto-reveal rounded-xl border border-border bg-card p-4">
                      <span className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">Missing skills for this role</span>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {reviewMissingSkills.map((skill) => (
                          <span key={skill} className="rounded-full border border-border bg-muted/40 px-2.5 py-1 text-[12.5px] font-medium text-foreground">
                            {skill}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Stage actions */}
                  <div className="auto-reveal flex flex-wrap gap-2">
                    {appState.application.status === 'draft' && !appState.latestRun && (
                      <button
                        type="button"
                        className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground transition-all hover:-translate-y-0.5 hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
                        disabled={actionBusy}
                        onClick={generateMaterials}
                      >
                        <Icon name="sparkles-outline" style={{ fontSize: 15 }} />
                        {actionBusy ? 'Generating…' : 'Generate materials'}
                      </button>
                    )}
                    {appState.application.status === 'draft' && (
                      <button
                        type="button"
                        className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-all hover:-translate-y-0.5 hover:brightness-110 active:translate-y-0 disabled:pointer-events-none disabled:opacity-50"
                        disabled={actionBusy}
                        onClick={runAutomation}
                      >
                        <Icon name="hardware-chip-outline" style={{ fontSize: 15 }} />
                        {actionBusy ? 'Running…' : 'Run automation'}
                      </button>
                    )}
                    {appState.latestRun?.status === 'ready_for_approval' && (
                      <button
                        type="button"
                        className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-all hover:-translate-y-0.5 hover:brightness-110 active:translate-y-0 disabled:pointer-events-none disabled:opacity-50"
                        disabled={actionBusy}
                        onClick={() => approveRun(appState.latestRun!.runNumber)}
                      >
                        <Icon name="shield-checkmark-outline" style={{ fontSize: 15 }} />
                        {actionBusy ? 'Confirming…' : 'Review and confirm'}
                      </button>
                    )}
                    {appState.latestRun?.status === 'approved' && (
                      <button
                        type="button"
                        className="inline-flex items-center justify-center gap-2 rounded-lg bg-cyan px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-all hover:-translate-y-0.5 hover:brightness-110 active:translate-y-0 disabled:pointer-events-none disabled:opacity-50"
                        disabled={actionBusy}
                        onClick={() => submitRun(appState.latestRun!.runNumber)}
                      >
                        <Icon name="checkmark-outline" style={{ fontSize: 15 }} />
                        {actionBusy ? 'Submitting…' : 'Submit application'}
                      </button>
                    )}
                  </div>
                </div>
              ) : ""}

              {activeTab === 'onsite' && (
                <>
                  <p style={{ color: 'var(--fg-2)', fontSize: 14 }}>
                    Apply directly on the original job posting. This opens the employer's site in a new tab so you
                    can complete the application there yourself.
                  </p>
                  {applyUrl ? (
                    <a href={applyUrl} target="_blank" rel="noreferrer" className="btn btn-indigo">
                      <Icon name="open-outline" />
                      Apply on site
                    </a>
                  ) : (
                    <button type="button" className="btn btn-indigo" disabled title="No application link on this job">
                      <Icon name="open-outline" />
                      Apply on site
                    </button>
                  )}
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
  )
}
