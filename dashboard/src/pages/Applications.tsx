import { useEffect, useMemo, useState } from 'react'
import type { Application, ApplicationStatus, AutomationRun, Materials, Profile } from '@job-hunter/shared'
import { apiFetch } from '../api/client'
import { LogoChip } from '../components/LogoChip'
import { Button } from '../components/Button'
import { FormError } from '../components/FormError'
import { ScoreRing } from '../components/ScoreRing'
import { materialFileName } from '../lib/filename'

interface ApplicationsResponseBody {
  applications: Application[]
}

interface ApplicationDetailResponseBody {
  application: Application
  latestRun: AutomationRun | null
}

interface ApproveResponseBody {
  approved: boolean
  reason: string | null
}

// Automated apply (run/submit) drives a real headless browser and is only wired
// up for local development — gate those actions so deployed builds don't show
// buttons that can't work. Viewing applications and materials works everywhere.
const IS_LOCALHOST =
  typeof window !== 'undefined' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname)

const STATUS_COLUMNS: Array<{ status: ApplicationStatus; label: string }> = [
  { status: 'draft', label: 'Draft' },
  { status: 'ready', label: 'Ready for approval' },
  { status: 'submitted', label: 'Submitted' },
  { status: 'failed', label: 'Failed' },
]

const STATUS_LABELS: Record<ApplicationStatus, string> = Object.fromEntries(
  STATUS_COLUMNS.map(({ status, label }) => [status, label]),
) as Record<ApplicationStatus, string>

// Maps an application status to the `.auto` pill variant defined in index.css:
// draft -> plain, ready -> awaiting confirmation, submitted -> success, failed -> error.
function statusPillClass(status: ApplicationStatus): string {
  switch (status) {
    case 'ready':
      return 'auto wait'
    case 'submitted':
      return 'auto ok'
    case 'failed':
      return 'auto fail'
    default:
      return 'auto'
  }
}

function formatDateTime(isoString: string): string {
  return new Date(isoString).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength).trimEnd()}…`
}

interface TimelineEvent {
  at: string
  label: string
}

function buildTimeline(application: Application, latestRun: AutomationRun | null): TimelineEvent[] {
  const events: TimelineEvent[] = [{ at: application.createdAt, label: 'Application created' }]

  if (latestRun) {
    events.push({ at: latestRun.createdAt, label: `Run #${latestRun.runNumber} started — ${latestRun.status}` })
    if (latestRun.updatedAt !== latestRun.createdAt) {
      events.push({ at: latestRun.updatedAt, label: `Run #${latestRun.runNumber} updated — ${latestRun.status}` })
    }
  }

  if (application.updatedAt !== application.createdAt) {
    events.push({ at: application.updatedAt, label: `Application updated — ${application.status}` })
  }

  return events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
}

export function ApplicationsPage() {
  const [applications, setApplications] = useState<Application[] | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<ApplicationStatus | null>(null)

  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ApplicationDetailResponseBody | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)

  const [materials, setMaterials] = useState<Materials | null>(null)
  const [materialsStatus, setMaterialsStatus] = useState<'idle' | 'loading' | 'ready' | 'none' | 'error'>('idle')

  // Tracks which lifecycle action is in flight so only its button shows a busy
  // state and the others disable while it runs.
  const [actionBusy, setActionBusy] = useState<null | 'generate' | 'run' | 'answers' | 'submit' | 'download'>(null)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  // Draft edits for the required answers, keyed by question, before they're saved.
  const [answerDraft, setAnswerDraft] = useState<Record<string, string>>({})
  // Which document was just copied to the clipboard (for transient "Copied" feedback).
  const [copied, setCopied] = useState<string | null>(null)

  function copyText(key: string, text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key)
      setTimeout(() => setCopied(null), 1600)
    })
  }

  function loadApplications() {
    setListError(null)
    apiFetch('/applications')
      .then(async (res) => {
        if (!res.ok) {
          setListError('Failed to load applications.')
          return
        }
        const data: ApplicationsResponseBody = await res.json()
        setApplications(data.applications)
      })
      .catch(() => setListError('Failed to load applications.'))
  }

  useEffect(() => {
    loadApplications()
    // Load the profile once so downloads can be named with the user's name + email.
    apiFetch('/profile')
      .then((res) => (res.ok ? (res.json() as Promise<Profile>) : null))
      .then(setProfile)
      .catch(() => setProfile(null))
  }, [])

  // Default to the first application once the list arrives, if nothing is selected yet.
  useEffect(() => {
    if (selectedJobId === null && applications && applications.length > 0) {
      selectApplication(applications[0].jobId)
    }
  }, [applications])

  function loadDetail(jobId: string) {
    setDetailLoading(true)
    setDetailError(null)
    setActionMessage(null)
    setActionError(null)
    apiFetch(`/applications/${encodeURIComponent(jobId)}`)
      .then(async (res) => {
        if (!res.ok) {
          setDetailError('Failed to load application detail.')
          setDetail(null)
          return
        }
        const data: ApplicationDetailResponseBody = await res.json()
        setDetail(data)
        // Seed the editable answer drafts from whatever's stored so the inputs
        // show current values and edits are diffed against them on save.
        setAnswerDraft(
          Object.fromEntries(data.application.requiredAnswers.map((a) => [a.question, a.answer ?? ''])),
        )
      })
      .catch(() => {
        setDetailError('Failed to load application detail.')
        setDetail(null)
      })
      .finally(() => setDetailLoading(false))

    loadMaterials(jobId)
  }

  // Materials may not exist yet for a job (generation hasn't run) — a 404 is a
  // normal "nothing to show" state, not an error.
  function loadMaterials(jobId: string) {
    setMaterialsStatus('loading')
    setMaterials(null)
    apiFetch(`/materials/${encodeURIComponent(jobId)}`)
      .then(async (res) => {
        if (res.status === 404) {
          setMaterialsStatus('none')
          return
        }
        if (!res.ok) {
          setMaterialsStatus('error')
          return
        }
        const data: Materials = await res.json()
        setMaterials(data)
        setMaterialsStatus('ready')
      })
      .catch(() => setMaterialsStatus('error'))
  }

  function selectApplication(jobId: string) {
    setSelectedJobId(jobId)
    loadDetail(jobId)
  }

  function toggleStatusFilter(status: ApplicationStatus) {
    setStatusFilter((current) => (current === status ? null : status))
  }

  async function readError(res: Response, fallback: string): Promise<string> {
    const body = await res.json().catch(() => null)
    return body?.error ?? body?.reason ?? fallback
  }

  // Generate (or regenerate) tailored materials for the selected application.
  async function handleGenerateMaterials() {
    if (!detail) return
    const jobId = detail.application.jobId
    setActionBusy('generate')
    setActionError(null)
    setActionMessage(null)
    try {
      const res = await apiFetch(`/materials/${encodeURIComponent(jobId)}/generate`, { method: 'POST' })
      if (!res.ok) {
        setActionError(await readError(res, 'Failed to generate materials.'))
        return
      }
      const body = await res.json()
      if (body.status === 'deferred') {
        setActionError(`Materials deferred: ${body.reason}`)
        return
      }
      setActionMessage('Materials generated.')
      loadDetail(jobId)
      loadApplications()
    } catch {
      setActionError('Failed to generate materials.')
    } finally {
      setActionBusy(null)
    }
  }

  // Download the ATS-tailored CV (latest version) for the selected application.
  async function downloadTailoredCv(format: 'pdf' | 'docx') {
    if (!detail) return
    const jobId = detail.application.jobId
    setActionBusy('download')
    setActionError(null)
    try {
      const res = await apiFetch(
        `/materials/${encodeURIComponent(jobId)}/export?doc=tailoredCv&format=${format}`,
      )
      if (!res.ok) {
        setActionError('Failed to download tailored CV.')
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = materialFileName({
        fullName: profile?.resume?.fullName,
        email: profile?.email,
        kind: 'cv',
        ext: format,
      })
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch {
      setActionError('Failed to download tailored CV.')
    } finally {
      setActionBusy(null)
    }
  }

  // Launch the headless-browser automation run that fills the application form.
  async function handleRunAutomation() {
    if (!detail) return
    const jobId = detail.application.jobId
    setActionBusy('run')
    setActionError(null)
    setActionMessage(null)
    try {
      const res = await apiFetch(`/automation/${encodeURIComponent(jobId)}/run`, { method: 'POST' })
      if (!res.ok) {
        setActionError(await readError(res, 'Failed to run automation.'))
        return
      }
      setActionMessage('Automation run complete.')
      loadDetail(jobId)
      loadApplications()
    } catch {
      setActionError('Failed to run automation.')
    } finally {
      setActionBusy(null)
    }
  }

  // Persist the edited required answers so the run can clear the submit gate.
  async function handleSaveAnswers() {
    if (!detail) return
    const jobId = detail.application.jobId
    setActionBusy('answers')
    setActionError(null)
    setActionMessage(null)
    try {
      const answers = detail.application.requiredAnswers.map((entry) => ({
        question: entry.question,
        answer: answerDraft[entry.question]?.trim() ? answerDraft[entry.question].trim() : null,
      }))
      const res = await apiFetch(`/applications/${encodeURIComponent(jobId)}/answers`, {
        method: 'PUT',
        body: JSON.stringify({ answers }),
      })
      if (!res.ok) {
        setActionError(await readError(res, 'Failed to save answers.'))
        return
      }
      setActionMessage('Answers saved.')
      loadDetail(jobId)
    } catch {
      setActionError('Failed to save answers.')
    } finally {
      setActionBusy(null)
    }
  }

  // Approve the run, then — if approval succeeds — submit the application. These
  // are two backend steps; the UI drives them as one "Confirm & submit" action.
  async function handleConfirmAndSubmit() {
    if (!detail?.latestRun) return
    const jobId = detail.application.jobId
    const runNumber = detail.latestRun.runNumber
    setActionBusy('submit')
    setActionError(null)
    setActionMessage(null)
    try {
      const approveRes = await apiFetch(
        `/applications/${encodeURIComponent(jobId)}/runs/${runNumber}/approve`,
        { method: 'POST' },
      )
      if (!approveRes.ok) {
        setActionError(await readError(approveRes, 'Failed to approve this application.'))
        return
      }
      const approval: ApproveResponseBody = await approveRes.json()
      if (!approval.approved) {
        setActionError(approval.reason ?? 'Not approved — resolve the required answers first.')
        return
      }

      const submitRes = await apiFetch(`/automation/${encodeURIComponent(jobId)}/runs/${runNumber}/submit`, {
        method: 'POST',
      })
      if (!submitRes.ok) {
        setActionError(await readError(submitRes, 'Approved, but submission failed.'))
        loadDetail(jobId)
        loadApplications()
        return
      }
      const run: AutomationRun = await submitRes.json()
      setActionMessage(run.status === 'submitted' ? 'Application submitted.' : 'Submission attempt recorded as failed.')
      loadDetail(jobId)
      loadApplications()
    } catch {
      setActionError('Failed to submit this application.')
    } finally {
      setActionBusy(null)
    }
  }

  const requiredAnswersProgress = useMemo(() => {
    const requiredAnswers = detail?.application.requiredAnswers ?? []
    const answered = requiredAnswers.filter((item) => item.answer !== null).length
    const total = requiredAnswers.length
    const percentage = total === 0 ? 0 : Math.round((answered / total) * 100)
    return { answered, total, percentage }
  }, [detail])

  const counts = useMemo(() => {
    const base: Record<ApplicationStatus, number> = { draft: 0, ready: 0, submitted: 0, failed: 0 }
    for (const application of applications ?? []) {
      base[application.status] += 1
    }
    return base
  }, [applications])

  // The master list: every application, narrowed to the active status filter.
  const filteredApplications = useMemo(
    () => (applications ?? []).filter((application) => !statusFilter || application.status === statusFilter),
    [applications, statusFilter],
  )

  const hasApplications = (applications?.length ?? 0) > 0

  return (
    <>
      <header className="page-head">
        <div className="wrap">
          <div className="kicker">Applications</div>
          <h1>Track every application in flight.</h1>
          <p>From drafted materials to a submitted application, see where each one stands and approve the ones ready to go.</p>
        </div>
      </header>

      <section className="page-pad">
        <div className="wrap">
          {listError && (
            <div className="mb-4">
              <FormError message={listError} />
            </div>
          )}

          {!listError && applications === null ? (
            <p className="saved-empty">
              <b>Loading…</b>
            </p>
          ) : !listError && !hasApplications ? (
            <p className="saved-empty">
              <b>No applications yet</b>
              Generate materials from a job&apos;s detail page to start one.
            </p>
          ) : (
            <>
              <div className="app-stats">
                {STATUS_COLUMNS.map(({ status, label }) => (
                  <button
                    key={status}
                    type="button"
                    className={`astat${statusFilter === status ? ' on' : ''}`}
                    onClick={() => toggleStatusFilter(status)}
                  >
                    <div className="n">{counts[status]}</div>
                    <div className="l">{label}</div>
                  </button>
                ))}
              </div>

              <div className="app-workspace">
                <div className="app-list">
                  <div className="app-list-h">
                    <span>{statusFilter ? STATUS_LABELS[statusFilter] : 'All applications'}</span>
                    <span className="n">{filteredApplications.length}</span>
                  </div>
                  {filteredApplications.map((application) => (
                    <button
                      key={application.jobId}
                      type="button"
                      className={`acard${selectedJobId === application.jobId ? ' on' : ''}`}
                      onClick={() => selectApplication(application.jobId)}
                    >
                      <div className="r">
                        <LogoChip name={application.company} />
                        <div>
                          <b>{application.title}</b>
                          <small>{application.company}</small>
                        </div>
                      </div>
                      <div style={{ marginTop: 10 }}>
                        <span className={statusPillClass(application.status)}>{STATUS_LABELS[application.status]}</span>
                      </div>
                      <div className="foot">
                        <span>{application.materialsVersion != null ? `v${application.materialsVersion}` : 'no materials'}</span>
                        <span>{formatDateTime(application.updatedAt)}</span>
                      </div>
                    </button>
                  ))}
                  {filteredApplications.length === 0 && (
                    <p style={{ color: 'var(--muted-text)', fontSize: 13, padding: '4px 2px' }}>
                      No applications in this status.
                    </p>
                  )}
                </div>

                {!selectedJobId ? (
                  <div className="app-detail-empty">Select an application to see its details.</div>
                ) : (
                <div className="timeline">
                  <div className="tl-activity ev-card">
                    <h2 style={{ fontSize: 18, marginBottom: 14 }}>Activity</h2>
                    {detailLoading ? (
                      <p style={{ color: 'var(--muted-text)', fontSize: 14 }}>Loading…</p>
                    ) : detailError ? (
                      <FormError message={detailError} />
                    ) : detail ? (
                      <ul className="tl">
                        {buildTimeline(detail.application, detail.latestRun).map((event, index) => (
                          <li key={`${event.at}-${index}`}>
                            {event.label}
                            <small>{formatDateTime(event.at)}</small>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>

                  {detail && (
                    <div className="ev-card tl-detail">
                      <div className="head">
                        <div>
                          <div className="t">Application</div>
                          <div className="v">
                            {detail.application.title} · {detail.application.company}
                          </div>
                        </div>
                        <span className={statusPillClass(detail.application.status)}>
                          {STATUS_LABELS[detail.application.status]}
                        </span>
                      </div>

                      <div className="ev-kv" style={{ marginTop: 18 }}>
                        <div>
                          <div className="t">Updated</div>
                          <div className="v">{formatDateTime(detail.application.updatedAt)}</div>
                        </div>
                        <div>
                          <div className="t">Materials</div>
                          <div className="v">
                            {detail.application.materialsVersion != null ? `v${detail.application.materialsVersion}` : '—'}
                          </div>
                        </div>
                        <div>
                          <div className="t">Latest run</div>
                          <div className="v">{detail.latestRun ? `#${detail.latestRun.runNumber} · ${detail.latestRun.status}` : '—'}</div>
                        </div>
                        <div>
                          <div className="t">Manual apply</div>
                          <div className="v">
                            {detail.latestRun?.manualApplyUrl ? (
                              <a href={detail.latestRun.manualApplyUrl} target="_blank" rel="noreferrer">
                                Open link
                              </a>
                            ) : (
                              '—'
                            )}
                          </div>
                        </div>
                      </div>

                      {detail.latestRun?.blockReason && (
                        <div style={{ marginTop: 14 }}>
                          <div className="ev-kv">
                            <div>
                              <div className="t">Blocked</div>
                              <div className="v warn">{detail.latestRun.blockReason}</div>
                            </div>
                          </div>
                        </div>
                      )}

                      {detail.application.requiredAnswers.length > 0 && (
                        <div style={{ marginTop: 18 }}>
                          <div className="t" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--faint)' }}>
                            Required answers
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}>
                            <ScoreRing score={requiredAnswersProgress.percentage} size={40} strokeWidth={4} />
                            <span style={{ fontSize: 13, color: 'var(--muted-text)' }}>
                              {requiredAnswersProgress.answered} of {requiredAnswersProgress.total} answered
                            </span>
                          </div>
                          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                            {detail.application.requiredAnswers.map((item, index) => (
                              <label key={index} style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                                <span style={{ color: 'var(--fg-2)' }}>{item.question}</span>
                                <input
                                  className="field"
                                  type="text"
                                  value={answerDraft[item.question] ?? ''}
                                  placeholder="Your answer"
                                  disabled={detail.application.status === 'submitted' || actionBusy !== null}
                                  onChange={(event) =>
                                    setAnswerDraft((current) => ({ ...current, [item.question]: event.target.value }))
                                  }
                                />
                              </label>
                            ))}
                          </div>
                          {detail.application.status !== 'submitted' && (
                            <div style={{ marginTop: 10 }}>
                              <Button variant="ghost" onClick={handleSaveAnswers} disabled={actionBusy !== null}>
                                {actionBusy === 'answers' ? 'Saving…' : 'Save answers'}
                              </Button>
                            </div>
                          )}
                        </div>
                      )}

                      <div style={{ marginTop: 18 }}>
                        <div className="t" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--faint)' }}>
                          Materials preview
                        </div>
                        {(materialsStatus === 'loading' || actionBusy === 'generate' || actionBusy === 'run') && (
                          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }} aria-hidden="true">
                            <div className="sk" style={{ width: '32%' }} />
                            <div className="sk" style={{ width: '100%' }} />
                            <div className="sk" style={{ width: '92%' }} />
                            <div className="sk" style={{ width: '70%' }} />
                            <div className="sk" style={{ width: '28%', marginTop: 8 }} />
                            <div className="sk" style={{ width: '96%' }} />
                            <div className="sk" style={{ width: '60%' }} />
                          </div>
                        )}
                        {materialsStatus === 'none' && actionBusy !== 'generate' && actionBusy !== 'run' && (
                          <p style={{ marginTop: 8, color: 'var(--muted-text)', fontSize: 13.5 }}>
                            No materials generated for this application yet.
                          </p>
                        )}
                        {materialsStatus === 'error' && (
                          <div style={{ marginTop: 8 }}>
                            <FormError message="Failed to load materials." />
                          </div>
                        )}
                        {materialsStatus === 'ready' && materials && actionBusy !== 'generate' && actionBusy !== 'run' && (
                          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 12 }}>
                            <div>
                              <div className="dp-h">
                                <span>Cover letter</span>
                                <button
                                  type="button"
                                  className={`copy-btn${copied === 'cover' ? ' ok' : ''}`}
                                  onClick={() => copyText('cover', materials.coverLetter)}
                                >
                                  {copied === 'cover' ? 'Copied' : 'Copy'}
                                </button>
                              </div>
                              <p style={{ marginTop: 4, fontSize: 13.5, color: 'var(--fg-2)', lineHeight: 1.6 }}>
                                {truncate(materials.coverLetter, 320)}
                              </p>
                            </div>
                            <div>
                              <div className="dp-h">
                                <span>Tailored CV</span>
                                <button
                                  type="button"
                                  className={`copy-btn${copied === 'cv' ? ' ok' : ''}`}
                                  onClick={() => copyText('cv', materials.tailoredCv)}
                                >
                                  {copied === 'cv' ? 'Copied' : 'Copy'}
                                </button>
                              </div>
                              <p style={{ marginTop: 4, fontSize: 13.5, color: 'var(--fg-2)', lineHeight: 1.6 }}>
                                {truncate(materials.tailoredCv, 320)}
                              </p>
                              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                                <Button variant="ghost" onClick={() => downloadTailoredCv('pdf')} disabled={actionBusy !== null}>
                                  {actionBusy === 'download' ? 'Preparing…' : 'Download CV (PDF)'}
                                </Button>
                                <Button variant="ghost" onClick={() => downloadTailoredCv('docx')} disabled={actionBusy !== null}>
                                  Download CV (DOCX)
                                </Button>
                              </div>
                            </div>
                            {materials.unmetRequirements.length > 0 && (
                              <div>
                                <strong style={{ fontSize: 13 }}>Unmet requirements</strong>
                                <ul style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13.5 }}>
                                  {materials.unmetRequirements.map((requirement, index) => (
                                    <li key={index}>{requirement}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {actionError && (
                        <div style={{ marginTop: 14 }}>
                          <FormError message={actionError} />
                        </div>
                      )}

                      {actionMessage && (
                        <p style={{ marginTop: 14, fontSize: 13.5, color: 'var(--cyan-text)' }}>{actionMessage}</p>
                      )}

                      {detail.application.status === 'submitted' ? (
                        <p style={{ marginTop: 18, fontSize: 13.5, color: 'var(--cyan-text)' }}>
                          This application has been submitted — no further action needed.
                        </p>
                      ) : !IS_LOCALHOST ? (
                        <p style={{ marginTop: 18, fontSize: 13, color: 'var(--muted-text)' }}>
                          Automated apply (run &amp; submit) is available in local development. You can still generate and
                          copy materials to apply manually.
                        </p>
                      ) : (
                        <div className="ev-actions" style={{ flexWrap: 'wrap', gap: 10 }}>
                          <Button variant="ghost" onClick={handleGenerateMaterials} disabled={actionBusy !== null}>
                            {actionBusy === 'generate'
                              ? 'Generating…'
                              : materialsStatus === 'ready'
                                ? 'Regenerate materials'
                                : 'Generate materials'}
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={handleRunAutomation}
                            disabled={actionBusy !== null || materialsStatus !== 'ready'}
                          >
                            {actionBusy === 'run' ? 'Running…' : detail.latestRun ? 'Re-run automation' : 'Run automation'}
                          </Button>
                          <Button
                            variant="indigo"
                            onClick={handleConfirmAndSubmit}
                            disabled={
                              actionBusy !== null ||
                              !detail.latestRun ||
                              (detail.latestRun.status !== 'ready_for_approval' &&
                                detail.latestRun.status !== 'approved') ||
                              requiredAnswersProgress.answered < requiredAnswersProgress.total
                            }
                          >
                            {actionBusy === 'submit' ? 'Submitting…' : 'Confirm & submit'}
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                )}
              </div>
            </>
          )}
        </div>
      </section>
    </>
  )
}
