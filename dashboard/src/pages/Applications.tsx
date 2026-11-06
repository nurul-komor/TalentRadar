import { useEffect, useMemo, useState } from 'react'
import type {
  TrackedJob,
  TrackedJobInput,
  TrackedJobStatus,
  TrackedJobLocationType,
  UserJob,
  Application,
  Materials,
} from '@job-hunter/shared'
import { apiFetch } from '../api/client'
import { LogoChip } from '../components/LogoChip'
import { Button } from '../components/Button'
import { FormError } from '../components/FormError'
import {
  STATUS_META,
  statusLabel,
  statusPillClass,
  formatDate,
  isFollowUpOverdue,
  LOCATION_TYPE_LABELS,
  LOCATION_TYPE_OPTIONS,
} from '../lib/jobTracking'

type View = 'board' | 'table'

interface TrackedJobsResponse {
  jobs: TrackedJob[]
}

// The editable shape behind the add/edit form — every field a string so inputs
// bind cleanly; empty strings become nulls on save.
interface FormState {
  company: string
  position: string
  status: TrackedJobStatus
  jobUrl: string
  appliedDate: string
  salary: string
  contactPerson: string
  contactUrl: string
  location: string
  locationType: '' | TrackedJobLocationType
  followUpDate: string
  notes: string
}

const EMPTY_FORM: FormState = {
  company: '',
  position: '',
  status: 'not_applied',
  jobUrl: '',
  appliedDate: '',
  salary: '',
  contactPerson: '',
  contactUrl: '',
  location: '',
  locationType: '',
  followUpDate: '',
  notes: '',
}

function formFromJob(job: TrackedJob): FormState {
  return {
    company: job.company,
    position: job.position,
    status: job.status,
    jobUrl: job.jobUrl ?? '',
    appliedDate: job.appliedDate ?? '',
    salary: job.salary ?? '',
    contactPerson: job.contactPerson ?? '',
    contactUrl: job.contactUrl ?? '',
    location: job.location ?? '',
    locationType: job.locationType ?? '',
    followUpDate: job.followUpDate ?? '',
    notes: job.notes ?? '',
  }
}

// Turn the string-based form into an API payload, collapsing blanks to null.
function formToInput(form: FormState): TrackedJobInput {
  const orNull = (value: string) => (value.trim() ? value.trim() : null)
  return {
    company: form.company.trim(),
    position: form.position.trim(),
    status: form.status,
    jobUrl: orNull(form.jobUrl),
    appliedDate: orNull(form.appliedDate),
    salary: orNull(form.salary),
    contactPerson: orNull(form.contactPerson),
    contactUrl: orNull(form.contactUrl),
    location: orNull(form.location),
    locationType: form.locationType === '' ? null : form.locationType,
    followUpDate: orNull(form.followUpDate),
    notes: orNull(form.notes),
  }
}

export function ApplicationsPage() {
  const [jobs, setJobs] = useState<TrackedJob[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [view, setView] = useState<View>('board')
  const [statusFilter, setStatusFilter] = useState<TrackedJobStatus | null>(null)
  const [search, setSearch] = useState('')

  // Drawer drives both add (editing === null) and edit (editing is the job).
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editing, setEditing] = useState<TrackedJob | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [importOpen, setImportOpen] = useState(false)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOverStatus, setDragOverStatus] = useState<TrackedJobStatus | null>(null)

  function loadJobs() {
    setListError(null)
    apiFetch('/job-tracking')
      .then(async (res) => {
        if (!res.ok) {
          setListError('Failed to load tracked jobs.')
          return
        }
        const data: TrackedJobsResponse = await res.json()
        setJobs(data.jobs)
      })
      .catch(() => setListError('Failed to load tracked jobs.'))
  }

  useEffect(loadJobs, [])

  function openAdd() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setFormError(null)
    setDrawerOpen(true)
  }

  function openEdit(job: TrackedJob) {
    setEditing(job)
    setForm(formFromJob(job))
    setFormError(null)
    setDrawerOpen(true)
  }

  function closeDrawer() {
    setDrawerOpen(false)
    setEditing(null)
  }

  async function saveForm() {
    if (!form.company.trim() || !form.position.trim()) {
      setFormError('Company and position are required.')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      const payload = formToInput(form)
      const res = editing
        ? await apiFetch(`/job-tracking/${editing._id}`, { method: 'PATCH', body: JSON.stringify(payload) })
        : await apiFetch('/job-tracking', { method: 'POST', body: JSON.stringify(payload) })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setFormError(body?.error ?? 'Failed to save.')
        return
      }
      closeDrawer()
      loadJobs()
    } catch {
      setFormError('Failed to save.')
    } finally {
      setSaving(false)
    }
  }

  async function deleteJob(job: TrackedJob) {
    if (!window.confirm(`Remove ${job.position} at ${job.company} from your tracker?`)) return
    const res = await apiFetch(`/job-tracking/${job._id}`, { method: 'DELETE' })
    if (res.ok) {
      if (editing?._id === job._id) closeDrawer()
      loadJobs()
    }
  }

  // Patch just the status (inline table select, or a board drop). Optimistically
  // updates local state so the card moves instantly, then reconciles on reload.
  async function changeStatus(job: TrackedJob, status: TrackedJobStatus, order?: number) {
    if (job.status === status && order === undefined) return
    setJobs((current) =>
      (current ?? []).map((j) => (j._id === job._id ? { ...j, status, ...(order !== undefined ? { order } : {}) } : j)),
    )
    const body: Record<string, unknown> = { status }
    if (order !== undefined) body.order = order
    const res = await apiFetch(`/job-tracking/${job._id}`, { method: 'PATCH', body: JSON.stringify(body) })
    if (!res.ok) loadJobs()
  }

  const counts = useMemo(() => {
    const base = {} as Record<TrackedJobStatus, number>
    for (const meta of STATUS_META) base[meta.status] = 0
    for (const job of jobs ?? []) base[job.status] = (base[job.status] ?? 0) + 1
    return base
  }, [jobs])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return (jobs ?? []).filter((job) => {
      if (statusFilter && job.status !== statusFilter) return false
      if (!term) return true
      return (
        job.company.toLowerCase().includes(term) ||
        job.position.toLowerCase().includes(term) ||
        (job.location ?? '').toLowerCase().includes(term) ||
        (job.contactPerson ?? '').toLowerCase().includes(term)
      )
    })
  }, [jobs, statusFilter, search])

  const hasJobs = (jobs?.length ?? 0) > 0

  // Board drop: move the dragged job into `status` at the top of that column.
  function handleDrop(status: TrackedJobStatus) {
    const job = (jobs ?? []).find((j) => j._id === dragId)
    setDragId(null)
    setDragOverStatus(null)
    if (!job) return
    const columnMin = Math.min(0, ...(jobs ?? []).filter((j) => j.status === status).map((j) => j.order))
    changeStatus(job, status, columnMin - 1)
  }

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  return (
    <>
      <header className="page-head">
        <div className="wrap">
          <div className="kicker">Application Tracking</div>
          <h1>Track every application in one place.</h1>
          <p>From first contact to a signed offer — follow where each application stands and never miss a follow-up.</p>
        </div>
      </header>

      <section className="page-pad">
        <div className="wrap">
          {listError && (
            <div className="mb-4">
              <FormError message={listError} />
            </div>
          )}

          {/* Toolbar: view toggle · search · actions */}
          <div className="jt-toolbar">
            <div className="jt-viewtoggle" role="tablist" aria-label="View">
              <button
                type="button"
                role="tab"
                aria-selected={view === 'board'}
                className={view === 'board' ? 'on' : ''}
                onClick={() => setView('board')}
              >
                <ion-icon name="grid-outline" /> Board
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === 'table'}
                className={view === 'table' ? 'on' : ''}
                onClick={() => setView('table')}
              >
                <ion-icon name="list-outline" /> Table
              </button>
            </div>

            <div className="jt-search">
              <ion-icon name="search-outline" />
              <input
                type="text"
                placeholder="Search company, role, contact…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>

            <div className="jt-actions">
              <Button variant="ghost" onClick={() => setImportOpen(true)}>
                <ion-icon name="enter-outline" /> Import
              </Button>
              <Button variant="indigo" onClick={openAdd}>
                <ion-icon name="add-outline" /> Add application
              </Button>
            </div>
          </div>

          {/* Stat row doubles as a status filter */}
          {hasJobs && (
            <div className="jt-stats">
              <button
                type="button"
                className={`jt-stat${statusFilter === null ? ' on' : ''}`}
                onClick={() => setStatusFilter(null)}
              >
                <div className="n">{jobs?.length ?? 0}</div>
                <div className="l">All</div>
              </button>
              {STATUS_META.filter((meta) => counts[meta.status] > 0).map((meta) => (
                <button
                  key={meta.status}
                  type="button"
                  className={`jt-stat${statusFilter === meta.status ? ' on' : ''}`}
                  onClick={() => setStatusFilter((cur) => (cur === meta.status ? null : meta.status))}
                >
                  <div className="n">{counts[meta.status]}</div>
                  <div className="l">{meta.label}</div>
                </button>
              ))}
            </div>
          )}

          {jobs === null && !listError ? (
            <p className="saved-empty">
              <b>Loading…</b>
            </p>
          ) : !hasJobs ? (
            <p className="saved-empty">
              <b>No applications tracked yet</b>
              Add an application manually, or import one from your saved jobs and applications.
              <span style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 16 }}>
                <Button variant="ghost" onClick={() => setImportOpen(true)}>
                  <ion-icon name="enter-outline" /> Import
                </Button>
                <Button variant="indigo" onClick={openAdd}>
                  <ion-icon name="add-outline" /> Add your first application
                </Button>
              </span>
            </p>
          ) : view === 'board' ? (
            <div className="jt-board">
              {STATUS_META.map((meta) => {
                const columnJobs = filtered
                  .filter((job) => job.status === meta.status)
                  .sort((a, b) => a.order - b.order)
                return (
                  <div
                    key={meta.status}
                    className={`jt-col${dragOverStatus === meta.status ? ' drop' : ''}`}
                    onDragOver={(event) => {
                      event.preventDefault()
                      if (dragOverStatus !== meta.status) setDragOverStatus(meta.status)
                    }}
                    onDragLeave={(event) => {
                      // Only clear when leaving the column entirely, not a child.
                      if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                        setDragOverStatus((cur) => (cur === meta.status ? null : cur))
                      }
                    }}
                    onDrop={() => handleDrop(meta.status)}
                  >
                    <div className="jt-col-h">
                      <span className={`jt-dot ${meta.tone}`} aria-hidden="true" />
                      <span className="t">{meta.label}</span>
                      <span className="n">{columnJobs.length}</span>
                    </div>
                    <div className="jt-col-body">
                      {columnJobs.map((job) => {
                        const overdue = isFollowUpOverdue(job.followUpDate, job.status)
                        return (
                          <div
                            key={job._id}
                            role="button"
                            tabIndex={0}
                            className={`jt-card${dragId === job._id ? ' dragging' : ''}`}
                            draggable
                            onDragStart={(event) => {
                              // Some browsers need data set on the transfer for the drag to initiate.
                              event.dataTransfer.effectAllowed = 'move'
                              event.dataTransfer.setData('text/plain', job._id ?? '')
                              setDragId(job._id ?? null)
                            }}
                            onDragEnd={() => {
                              setDragId(null)
                              setDragOverStatus(null)
                            }}
                            onClick={() => openEdit(job)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault()
                                openEdit(job)
                              }
                            }}
                          >
                            <div className="r">
                              <LogoChip name={job.company} size={30} />
                              <div className="min0">
                                <b>{job.position}</b>
                                <small>{job.company}</small>
                              </div>
                            </div>
                            <div className="jt-card-meta">
                              {job.locationType && (
                                <span className="jt-tag">{LOCATION_TYPE_LABELS[job.locationType]}</span>
                              )}
                              {job.location && <span className="jt-tag muted">{job.location}</span>}
                              {job.materialsJobId && (
                                <span className="jt-tag docs" title="Résumé & cover letter generated">
                                  <ion-icon name="sparkles-outline" /> Docs
                                </span>
                              )}
                            </div>
                            {job.followUpDate && (
                              <div className={`jt-followup${overdue ? ' overdue' : ''}`}>
                                <ion-icon name="calendar-outline" />
                                {overdue ? 'Overdue · ' : 'Follow up · '}
                                {formatDate(job.followUpDate)}
                              </div>
                            )}
                          </div>
                        )
                      })}
                      {columnJobs.length === 0 && <div className="jt-col-empty">Drop here</div>}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="jt-table-wrap">
              <table className="jt-table">
                <thead>
                  <tr>
                    <th>Company / Role</th>
                    <th>Status</th>
                    <th>Location</th>
                    <th>Salary</th>
                    <th>Applied</th>
                    <th>Follow-up</th>
                    <th>Contact</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((job) => {
                    const overdue = isFollowUpOverdue(job.followUpDate, job.status)
                    return (
                      <tr key={job._id}>
                        <td>
                          <div className="jt-cell-co">
                            <LogoChip name={job.company} size={30} />
                            <div className="min0">
                              <b>{job.position}</b>
                              {job.jobUrl ? (
                                <a href={job.jobUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                                  {job.company} <ion-icon name="open-outline" />
                                </a>
                              ) : (
                                <small>{job.company}</small>
                              )}
                            </div>
                          </div>
                        </td>
                        <td>
                          <select
                            className={`jt-status-select ${statusPillClass(job.status)}`}
                            value={job.status}
                            onChange={(event) => changeStatus(job, event.target.value as TrackedJobStatus)}
                          >
                            {STATUS_META.map((meta) => (
                              <option key={meta.status} value={meta.status}>
                                {meta.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          {job.location || '—'}
                          {job.locationType && <span className="jt-tag" style={{ marginLeft: 6 }}>{LOCATION_TYPE_LABELS[job.locationType]}</span>}
                        </td>
                        <td>{job.salary || '—'}</td>
                        <td>{formatDate(job.appliedDate)}</td>
                        <td className={overdue ? 'jt-overdue-cell' : ''}>{formatDate(job.followUpDate)}</td>
                        <td>
                          {job.contactUrl ? (
                            <a href={job.contactUrl} target="_blank" rel="noreferrer">
                              {job.contactPerson || 'Contact'}
                            </a>
                          ) : (
                            job.contactPerson || '—'
                          )}
                        </td>
                        <td>
                          <div className="jt-row-actions">
                            <button type="button" title="Edit" onClick={() => openEdit(job)}>
                              <ion-icon name="create-outline" />
                            </button>
                            <button type="button" title="Remove" onClick={() => deleteJob(job)}>
                              <ion-icon name="trash-outline" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {filtered.length === 0 && (
                <p style={{ color: 'var(--muted-text)', fontSize: 13.5, padding: '16px 2px' }}>No jobs match this filter.</p>
              )}
            </div>
          )}
        </div>
      </section>

      {drawerOpen && (
        <JobDrawer
          editing={editing}
          form={form}
          set={set}
          error={formError}
          saving={saving}
          onClose={closeDrawer}
          onSave={saveForm}
          onDelete={editing ? () => deleteJob(editing) : undefined}
        />
      )}

      {importOpen && (
        <ImportModal
          onClose={() => setImportOpen(false)}
          onImported={() => {
            setImportOpen(false)
            loadJobs()
          }}
        />
      )}
    </>
  )
}

// --- Generated materials panel (shown in the edit drawer) ------------------

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max).trimEnd()}…`
}

function MaterialsPanel({ materialsJobId, company }: { materialsJobId: string; company: string }) {
  const [materials, setMaterials] = useState<Materials | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'none' | 'error'>('loading')
  const [copied, setCopied] = useState<string | null>(null)
  const [downloading, setDownloading] = useState<string | null>(null)

  useEffect(() => {
    setStatus('loading')
    apiFetch(`/materials/${encodeURIComponent(materialsJobId)}`)
      .then(async (res) => {
        if (res.status === 404) {
          setStatus('none')
          return
        }
        if (!res.ok) {
          setStatus('error')
          return
        }
        setMaterials(await res.json())
        setStatus('ready')
      })
      .catch(() => setStatus('error'))
  }, [materialsJobId])

  function copy(key: string, text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key)
      setTimeout(() => setCopied(null), 1500)
    })
  }

  async function download(doc: 'tailoredCv' | 'coverLetter', format: 'pdf' | 'docx') {
    const key = `${doc}-${format}`
    setDownloading(key)
    try {
      const version = materials?.version != null ? `&v=${materials.version}` : ''
      const res = await apiFetch(
        `/materials/${encodeURIComponent(materialsJobId)}/export?doc=${doc}&format=${format}${version}`,
      )
      if (!res.ok) return
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      const safeCompany = company.replace(/[^a-z0-9]+/gi, '-').toLowerCase()
      link.href = url
      link.download = `${safeCompany}-${doc === 'tailoredCv' ? 'resume' : 'cover-letter'}.${format}`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } finally {
      setDownloading(null)
    }
  }

  const docs: Array<{ key: 'coverLetter' | 'tailoredCv'; label: string }> = [
    { key: 'tailoredCv', label: 'Résumé (ATS)' },
    { key: 'coverLetter', label: 'Cover letter' },
  ]

  return (
    <div className="jt-materials">
      <div className="jt-materials-h">
        <ion-icon name="sparkles-outline" />
        Generated materials
      </div>
      {status === 'loading' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} aria-hidden="true">
          <div className="sk" style={{ width: '40%' }} />
          <div className="sk" style={{ width: '100%' }} />
          <div className="sk" style={{ width: '85%' }} />
        </div>
      )}
      {status === 'none' && (
        <p className="jt-materials-empty">
          No résumé or cover letter generated for this job yet. Generate them from the job&apos;s detail page.
        </p>
      )}
      {status === 'error' && <FormError message="Failed to load generated materials." />}
      {status === 'ready' && materials && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {docs.map(({ key, label }) => (
            <div key={key} className="jt-doc">
              <div className="jt-doc-h">
                <span>{label}</span>
                <button
                  type="button"
                  className={`jt-copy${copied === key ? ' ok' : ''}`}
                  onClick={() => copy(key, materials[key])}
                >
                  {copied === key ? 'Copied' : 'Copy'}
                </button>
              </div>
              <p className="jt-doc-preview">{truncate(materials[key], 360)}</p>
              <div className="jt-doc-actions">
                <Button variant="ghost" onClick={() => download(key, 'pdf')} disabled={downloading !== null}>
                  <ion-icon name="download-outline" /> {downloading === `${key}-pdf` ? 'Preparing…' : 'PDF'}
                </Button>
                <Button variant="ghost" onClick={() => download(key, 'docx')} disabled={downloading !== null}>
                  <ion-icon name="download-outline" /> {downloading === `${key}-docx` ? 'Preparing…' : 'DOCX'}
                </Button>
              </div>
            </div>
          ))}
          {materials.unmetRequirements.length > 0 && (
            <div className="jt-doc">
              <div className="jt-doc-h">
                <span>Unmet requirements</span>
              </div>
              <ul className="jt-unmet">
                {materials.unmetRequirements.map((req, index) => (
                  <li key={index}>{req}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// --- Add / edit drawer -----------------------------------------------------

interface JobDrawerProps {
  editing: TrackedJob | null
  form: FormState
  set: <K extends keyof FormState>(key: K, value: FormState[K]) => void
  error: string | null
  saving: boolean
  onClose: () => void
  onSave: () => void
  onDelete?: () => void
}

function JobDrawer({ editing, form, set, error, saving, onClose, onSave, onDelete }: JobDrawerProps) {
  return (
    <div className="jt-overlay" onClick={onClose}>
      <div className="jt-drawer" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="jt-drawer-h">
          <h2>{editing ? 'Edit application' : 'Add application'}</h2>
          <button type="button" className="jt-icon-btn" onClick={onClose} aria-label="Close">
            <ion-icon name="close-outline" />
          </button>
        </div>

        <div className="jt-drawer-body">
          <div className="jt-fgrid">
            <label className="jt-field">
              <span>Company *</span>
              <input value={form.company} onChange={(e) => set('company', e.target.value)} placeholder="Acme Inc." />
            </label>
            <label className="jt-field">
              <span>Position *</span>
              <input value={form.position} onChange={(e) => set('position', e.target.value)} placeholder="Senior Engineer" />
            </label>
            <label className="jt-field">
              <span>Status</span>
              <select value={form.status} onChange={(e) => set('status', e.target.value as TrackedJobStatus)}>
                {STATUS_META.map((meta) => (
                  <option key={meta.status} value={meta.status}>
                    {meta.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="jt-field">
              <span>Location type</span>
              <select value={form.locationType} onChange={(e) => set('locationType', e.target.value as FormState['locationType'])}>
                <option value="">—</option>
                {LOCATION_TYPE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {LOCATION_TYPE_LABELS[option]}
                  </option>
                ))}
              </select>
            </label>
            <label className="jt-field">
              <span>Location</span>
              <input value={form.location} onChange={(e) => set('location', e.target.value)} placeholder="Dhaka / Remote" />
            </label>
            <label className="jt-field">
              <span>Salary</span>
              <input value={form.salary} onChange={(e) => set('salary', e.target.value)} placeholder="BDT 160,000–210,000" />
            </label>
            <label className="jt-field">
              <span>Applied date</span>
              <input type="date" value={form.appliedDate} onChange={(e) => set('appliedDate', e.target.value)} />
            </label>
            <label className="jt-field">
              <span>Follow-up date</span>
              <input type="date" value={form.followUpDate} onChange={(e) => set('followUpDate', e.target.value)} />
            </label>
            <label className="jt-field full">
              <span>Job URL</span>
              <input value={form.jobUrl} onChange={(e) => set('jobUrl', e.target.value)} placeholder="https://…" />
            </label>
            <label className="jt-field">
              <span>Contact person</span>
              <input value={form.contactPerson} onChange={(e) => set('contactPerson', e.target.value)} placeholder="Name" />
            </label>
            <label className="jt-field">
              <span>Contact URL</span>
              <input value={form.contactUrl} onChange={(e) => set('contactUrl', e.target.value)} placeholder="https://linkedin.com/…" />
            </label>
            <label className="jt-field full">
              <span>Notes</span>
              <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Anything worth remembering…" rows={4} />
            </label>
          </div>

          {editing?.materialsJobId && (
            <MaterialsPanel materialsJobId={editing.materialsJobId} company={editing.company} />
          )}

          {error && (
            <div style={{ marginTop: 14 }}>
              <FormError message={error} />
            </div>
          )}
        </div>

        <div className="jt-drawer-foot">
          {onDelete && (
            <Button variant="ghost" onClick={onDelete} disabled={saving}>
              <ion-icon name="trash-outline" /> Remove
            </Button>
          )}
          <div style={{ flex: 1 }} />
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="indigo" onClick={onSave} disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Add application'}
          </Button>
        </div>
      </div>
    </div>
  )
}

// --- Import modal ----------------------------------------------------------

interface ImportSource {
  kind: 'userJob' | 'application'
  id: string
  title: string
  subtitle: string
}

function ImportModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [sources, setSources] = useState<ImportSource[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      apiFetch('/user-jobs')
        .then((res) => (res.ok ? res.json() : { jobs: [] }))
        .catch(() => ({ jobs: [] })),
      apiFetch('/applications')
        .then((res) => (res.ok ? res.json() : { applications: [] }))
        .catch(() => ({ applications: [] })),
    ])
      .then(([userJobsBody, appsBody]) => {
        const userJobs: ImportSource[] = (userJobsBody.jobs as UserJob[]).map((job) => ({
          kind: 'userJob',
          id: job._id ?? '',
          title: job.title,
          subtitle: job.company,
        }))
        const apps: ImportSource[] = (appsBody.applications as Application[]).map((app) => ({
          kind: 'application',
          id: app.jobId,
          title: app.title,
          subtitle: app.company,
        }))
        setSources([...userJobs, ...apps])
      })
      .catch(() => setError('Failed to load importable jobs.'))
  }, [])

  async function importOne(source: ImportSource) {
    setBusyId(source.id)
    setError(null)
    try {
      const res = await apiFetch('/job-tracking/import', {
        method: 'POST',
        body: JSON.stringify({ kind: source.kind, id: source.id }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setError(body?.error ?? 'Failed to import.')
        return
      }
      onImported()
    } catch {
      setError('Failed to import.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="jt-overlay" onClick={onClose}>
      <div className="jt-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="jt-drawer-h">
          <h2>Import an application</h2>
          <button type="button" className="jt-icon-btn" onClick={onClose} aria-label="Close">
            <ion-icon name="close-outline" />
          </button>
        </div>
        <div className="jt-modal-body">
          <p style={{ color: 'var(--muted-text)', fontSize: 13.5, marginBottom: 14 }}>
            Pull a job you already saved or started an application for into your tracker.
          </p>
          {error && (
            <div style={{ marginBottom: 12 }}>
              <FormError message={error} />
            </div>
          )}
          {sources === null ? (
            <p style={{ color: 'var(--muted-text)', fontSize: 14 }}>Loading…</p>
          ) : sources.length === 0 ? (
            <p className="saved-empty" style={{ padding: 28 }}>
              <b>Nothing to import</b>
              Save a job or start an application first.
            </p>
          ) : (
            <div className="jt-import-list">
              {sources.map((source) => (
                <div key={`${source.kind}-${source.id}`} className="jt-import-row">
                  <LogoChip name={source.subtitle} size={30} />
                  <div className="min0">
                    <b>{source.title}</b>
                    <small>
                      {source.subtitle} · {source.kind === 'userJob' ? 'Saved job' : 'Application'}
                    </small>
                  </div>
                  <Button variant="ghost" onClick={() => importOne(source)} disabled={busyId === source.id}>
                    {busyId === source.id ? 'Importing…' : 'Import'}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
