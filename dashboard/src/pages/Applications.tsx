import { useEffect, useMemo, useState } from 'react'
import type { Application, ApplicationStatus, AutomationRun, Materials } from '@job-hunter/shared'
import { apiFetch } from '../api/client'
import { LogoChip } from '../components/LogoChip'
import { Button } from '../components/Button'
import { FormError } from '../components/FormError'
import { ScoreRing } from '../components/ScoreRing'

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
  const [listError, setListError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<ApplicationStatus | null>(null)

  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ApplicationDetailResponseBody | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)

  const [materials, setMaterials] = useState<Materials | null>(null)
  const [materialsStatus, setMaterialsStatus] = useState<'idle' | 'loading' | 'ready' | 'none' | 'error'>('idle')

  const [approving, setApproving] = useState(false)
  const [approveResult, setApproveResult] = useState<ApproveResponseBody | null>(null)
  const [approveError, setApproveError] = useState<string | null>(null)

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
    setApproveResult(null)
    setApproveError(null)
    apiFetch(`/applications/${encodeURIComponent(jobId)}`)
      .then(async (res) => {
        if (!res.ok) {
          setDetailError('Failed to load application detail.')
          setDetail(null)
          return
        }
        const data: ApplicationDetailResponseBody = await res.json()
        setDetail(data)
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

  async function handleApprove() {
    if (!detail?.latestRun) return
    setApproving(true)
    setApproveError(null)
    setApproveResult(null)
    try {
      const res = await apiFetch(
        `/applications/${encodeURIComponent(detail.application.jobId)}/runs/${detail.latestRun.runNumber}/approve`,
        { method: 'POST' },
      )
      if (!res.ok) {
        setApproveError('Failed to approve this application.')
        return
      }
      const result: ApproveResponseBody = await res.json()
      setApproveResult(result)
      loadDetail(detail.application.jobId)
      loadApplications()
    } catch {
      setApproveError('Failed to approve this application.')
    } finally {
      setApproving(false)
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

  const applicationsByStatus = useMemo(() => {
    const grouped: Record<ApplicationStatus, Application[]> = { draft: [], ready: [], submitted: [], failed: [] }
    for (const application of applications ?? []) {
      grouped[application.status].push(application)
    }
    return grouped
  }, [applications])

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

              <div className="board">
                {STATUS_COLUMNS.filter(({ status }) => !statusFilter || statusFilter === status).map(
                  ({ status, label }) => (
                    <div className="col" key={status}>
                      <div className="col-h">
                        <span>
                          <i />
                          {label}
                        </span>
                        <span className="n">{applicationsByStatus[status].length}</span>
                      </div>
                      {applicationsByStatus[status].map((application) => (
                        <button
                          key={application.jobId}
                          type="button"
                          className="acard"
                          style={{ width: '100%', textAlign: 'left', cursor: 'pointer', border: 'none', font: 'inherit' }}
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
                      {applicationsByStatus[status].length === 0 && (
                        <p style={{ color: 'var(--muted-text)', fontSize: 13 }}>Nothing here.</p>
                      )}
                    </div>
                  ),
                )}
              </div>

              {selectedJobId && (
                <div className="timeline">
                  <div>
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
                    <div className="ev-card">
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
                          <ul style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13.5 }}>
                            {detail.application.requiredAnswers.map((item, index) => (
                              <li key={index}>
                                <strong>{item.question}</strong>: {item.answer ?? <em>Not answered</em>}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      <div style={{ marginTop: 18 }}>
                        <div className="t" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--faint)' }}>
                          Materials preview
                        </div>
                        {materialsStatus === 'loading' && (
                          <p style={{ marginTop: 8, color: 'var(--muted-text)', fontSize: 13.5 }}>Loading…</p>
                        )}
                        {materialsStatus === 'none' && (
                          <p style={{ marginTop: 8, color: 'var(--muted-text)', fontSize: 13.5 }}>
                            No materials generated for this application yet.
                          </p>
                        )}
                        {materialsStatus === 'error' && (
                          <div style={{ marginTop: 8 }}>
                            <FormError message="Failed to load materials." />
                          </div>
                        )}
                        {materialsStatus === 'ready' && materials && (
                          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 12 }}>
                            <div>
                              <strong style={{ fontSize: 13 }}>Cover letter</strong>
                              <p style={{ marginTop: 4, fontSize: 13.5, color: 'var(--fg-2)', lineHeight: 1.6 }}>
                                {truncate(materials.coverLetter, 320)}
                              </p>
                            </div>
                            <div>
                              <strong style={{ fontSize: 13 }}>Tailored CV</strong>
                              <p style={{ marginTop: 4, fontSize: 13.5, color: 'var(--fg-2)', lineHeight: 1.6 }}>
                                {truncate(materials.tailoredCv, 320)}
                              </p>
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

                      {approveError && (
                        <div style={{ marginTop: 14 }}>
                          <FormError message={approveError} />
                        </div>
                      )}

                      {approveResult && (
                        <p style={{ marginTop: 14, fontSize: 13.5, color: approveResult.approved ? 'var(--cyan-text)' : '#E5484D' }}>
                          {approveResult.approved ? 'Approved and submitted.' : approveResult.reason ?? 'Not approved.'}
                        </p>
                      )}

                      <div className="ev-actions">
                        <Button
                          variant="indigo"
                          onClick={handleApprove}
                          disabled={detail.application.status !== 'ready' || !detail.latestRun || approving}
                        >
                          {approving ? 'Confirming…' : 'Confirm & submit'}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </>
  )
}
