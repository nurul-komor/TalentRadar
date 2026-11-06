import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { UserJob, UserJobPreview, UserJobVisibility } from '@job-hunter/shared'
import { apiFetch } from '../api/client'
import { Button } from '../components/Button'
import { FormError } from '../components/FormError'
import { Pill } from '../components/Pill'

type Mode = 'link' | 'manual'

interface FormState {
  title: string
  company: string
  location: string
  salaryMin: string
  salaryMax: string
  description: string
  url: string
}

const EMPTY_FORM: FormState = {
  title: '',
  company: '',
  location: '',
  salaryMin: '',
  salaryMax: '',
  description: '',
  url: '',
}

function numberOrNull(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed.replace(/[,$]/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

function formFromPreview(preview: UserJobPreview): FormState {
  return {
    title: preview.title,
    company: preview.company,
    location: preview.location ?? '',
    salaryMin: preview.salaryMin != null ? String(preview.salaryMin) : '',
    salaryMax: preview.salaryMax != null ? String(preview.salaryMax) : '',
    description: preview.description,
    url: preview.url,
  }
}

export function AddJobPage() {
  const [mode, setMode] = useState<Mode>('link')
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [visibility, setVisibility] = useState<UserJobVisibility>('private')
  const [syncUrl, setSyncUrl] = useState('')
  const [syncBusy, setSyncBusy] = useState(false)
  const [hasPreview, setHasPreview] = useState(false)
  const [saveBusy, setSaveBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [jobs, setJobs] = useState<UserJob[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    apiFetch('/user-jobs')
      .then((res) => (res.ok ? res.json() : { jobs: [] }))
      .then((body: { jobs: UserJob[] }) => setJobs(body.jobs))
      .catch(() => setJobs([]))
  }, [])

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function syncFromUrl() {
    const url = syncUrl.trim()
    if (!url) return
    setSyncBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res = await apiFetch('/user-jobs/preview', {
        method: 'POST',
        body: JSON.stringify({ url }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setError(body?.error ?? 'Failed to read that page.')
        return
      }
      setForm(formFromPreview(body as UserJobPreview))
      setHasPreview(true)
      setNotice('Preview ready — review the details below, then save.')
    } catch {
      setError('Failed to reach the server.')
    } finally {
      setSyncBusy(false)
    }
  }

  async function save() {
    if (!form.title.trim() || !form.company.trim()) {
      setError('Title and company are required.')
      return
    }
    setSaveBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res = await apiFetch('/user-jobs', {
        method: 'POST',
        body: JSON.stringify({
          title: form.title.trim(),
          company: form.company.trim(),
          description: form.description,
          location: form.location.trim() || null,
          salaryMin: numberOrNull(form.salaryMin),
          salaryMax: numberOrNull(form.salaryMax),
          url: form.url.trim() || null,
          visibility,
        }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setError(body?.error ?? 'Failed to save the job.')
        return
      }
      setJobs((prev) => [body as UserJob, ...prev])
      setForm(EMPTY_FORM)
      setVisibility('private')
      setSyncUrl('')
      setHasPreview(false)
      setNotice('Saved to your job list.')
    } finally {
      setSaveBusy(false)
    }
  }

  async function toggleVisibility(job: UserJob) {
    if (!job._id) return
    const next: UserJobVisibility = job.visibility === 'private' ? 'public' : 'private'
    setBusyId(job._id)
    setError(null)
    try {
      const res = await apiFetch(`/user-jobs/${job._id}`, {
        method: 'PATCH',
        body: JSON.stringify({ visibility: next }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setError(body?.error ?? `Couldn't change visibility (HTTP ${res.status}).`)
        return
      }
      const updated = (await res.json()) as UserJob
      setJobs((prev) => prev.map((j) => (j._id === job._id ? updated : j)))
    } catch {
      setError('Failed to reach the server.')
    } finally {
      setBusyId(null)
    }
  }

  async function remove(job: UserJob) {
    if (!job._id) return
    setBusyId(job._id)
    setError(null)
    try {
      const res = await apiFetch(`/user-jobs/${job._id}`, { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setError(body?.error ?? `Couldn't delete the job (HTTP ${res.status}).`)
        return
      }
      setJobs((prev) => prev.filter((j) => j._id !== job._id))
    } catch {
      setError('Failed to reach the server.')
    } finally {
      setBusyId(null)
    }
  }

  const canSave = form.title.trim().length > 0 && form.company.trim().length > 0

  return (
    <>
      <header className="page-head">
        <div className="wrap">
          <div className="kicker">Jobs</div>
          <h1>Add a job</h1>
          <p>Paste a link to any job posting and sync a preview, or enter the details yourself. Saved jobs land in your private list — flip any of them public whenever you like.</p>
          <Link to="/jobs" className="btn btn-ghost" style={{ marginTop: 8 }}>
            <ion-icon name="briefcase-outline" />
            View on jobs page
          </Link>
        </div>
      </header>

      <div className="wrap" style={{ paddingBottom: 56 }}>
        {error && <FormError message={error} />}
        {notice && <div className="add-job-notice">{notice}</div>}

        <div className="segment" role="tablist" aria-label="How to add a job" style={{ marginBottom: 20 }}>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'link'}
            className={`seg${mode === 'link' ? ' on' : ''}`}
            onClick={() => setMode('link')}
          >
            <ion-icon name="link-outline" /> From a link
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'manual'}
            className={`seg${mode === 'manual' ? ' on' : ''}`}
            onClick={() => setMode('manual')}
          >
            <ion-icon name="create-outline" /> Enter manually
          </button>
        </div>

        {mode === 'link' && (
          <div className="add-job-sync">
            <div className="field full">
              <label htmlFor="syncUrl">Job posting URL</label>
              <div className="in">
                <ion-icon name="link-outline" />
                <input
                  id="syncUrl"
                  type="url"
                  placeholder="https://company.com/careers/senior-engineer"
                  value={syncUrl}
                  onChange={(e) => setSyncUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      void syncFromUrl()
                    }
                  }}
                />
              </div>
            </div>
            <Button variant="indigo" onClick={syncFromUrl} disabled={syncBusy || !syncUrl.trim()}>
              <ion-icon name="refresh-outline" />
              {syncBusy ? 'Syncing…' : 'Sync preview'}
            </Button>
          </div>
        )}

        {(mode === 'manual' || hasPreview) && (
          <section className="psec add-job-form">
            <h2>{mode === 'link' ? 'Preview' : 'Job details'}</h2>
            <div className="fgrid">
              <div className="field">
                <label htmlFor="title">Title</label>
                <div className="in">
                  <input id="title" value={form.title} onChange={(e) => setField('title', e.target.value)} placeholder="Senior Backend Engineer" />
                </div>
              </div>
              <div className="field">
                <label htmlFor="company">Company</label>
                <div className="in">
                  <ion-icon name="business-outline" />
                  <input id="company" value={form.company} onChange={(e) => setField('company', e.target.value)} placeholder="Acme Corp" />
                </div>
              </div>
              <div className="field">
                <label htmlFor="location">Location</label>
                <div className="in">
                  <ion-icon name="location-outline" />
                  <input id="location" value={form.location} onChange={(e) => setField('location', e.target.value)} placeholder="Remote" />
                </div>
              </div>
              <div className="field">
                <label htmlFor="url">Source URL</label>
                <div className="in">
                  <ion-icon name="link-outline" />
                  <input id="url" value={form.url} onChange={(e) => setField('url', e.target.value)} placeholder="https://…" />
                </div>
              </div>
              <div className="field">
                <label htmlFor="salaryMin">Salary min</label>
                <div className="in">
                  <ion-icon name="wallet-outline" />
                  <input id="salaryMin" inputMode="numeric" value={form.salaryMin} onChange={(e) => setField('salaryMin', e.target.value)} placeholder="80000" />
                </div>
              </div>
              <div className="field">
                <label htmlFor="salaryMax">Salary max</label>
                <div className="in">
                  <ion-icon name="wallet-outline" />
                  <input id="salaryMax" inputMode="numeric" value={form.salaryMax} onChange={(e) => setField('salaryMax', e.target.value)} placeholder="120000" />
                </div>
              </div>
              <div className="field full">
                <label htmlFor="description">Description</label>
                <textarea
                  id="description"
                  value={form.description}
                  onChange={(e) => setField('description', e.target.value)}
                  placeholder="Role summary, responsibilities, requirements…"
                  style={{ minHeight: 180 }}
                />
              </div>
              <div className="field full">
                <label>Visibility</label>
                <div className="segment" role="radiogroup" aria-label="Visibility">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={visibility === 'private'}
                    className={`seg${visibility === 'private' ? ' on' : ''}`}
                    onClick={() => setVisibility('private')}
                  >
                    <ion-icon name="lock-closed-outline" /> Private
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={visibility === 'public'}
                    className={`seg${visibility === 'public' ? ' on' : ''}`}
                    onClick={() => setVisibility('public')}
                  >
                    <ion-icon name="globe-outline" /> Public
                  </button>
                </div>
                <p className="add-job-hint">
                  {visibility === 'private'
                    ? 'Only you can see this job.'
                    : 'Marked public — visible beyond your private list.'}
                </p>
              </div>
            </div>
            <Button variant="indigo" onClick={save} disabled={saveBusy || !canSave} style={{ marginTop: 6 }}>
              <ion-icon name="save-outline" />
              {saveBusy ? 'Saving…' : 'Save to my job list'}
            </Button>
          </section>
        )}

        <section className="psec" style={{ marginTop: 36 }}>
          <h2>My jobs {jobs.length > 0 && <span className="add-job-count">({jobs.length})</span>}</h2>
          {jobs.length === 0 ? (
            <p style={{ color: 'var(--muted-text)' }}>No jobs added yet. Sync a link or add one manually above.</p>
          ) : (
            <div className="add-job-list">
              {jobs.map((job) => (
                <div className="add-job-card" key={job._id}>
                  <div className="aj-main">
                    <div className="aj-title">{job.title}</div>
                    <div className="aj-meta">
                      <span><ion-icon name="business-outline" /> {job.company}</span>
                      {job.location && <span><ion-icon name="location-outline" /> {job.location}</span>}
                      {job.url && (
                        <a href={job.url} target="_blank" rel="noreferrer" className="aj-link">
                          <ion-icon name="open-outline" /> Source
                        </a>
                      )}
                    </div>
                  </div>
                  <div className="aj-actions">
                    <Pill tone={job.visibility === 'public' ? 'verified' : 'mono'}>
                      {job.visibility === 'public' ? 'Public' : 'Private'}
                    </Pill>
                    <Link to={`/my-jobs/${job._id}`} className="btn btn-ghost btn-sm">
                      <ion-icon name="eye-outline" /> View
                    </Link>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busyId === job._id}
                      onClick={() => toggleVisibility(job)}
                    >
                      Make {job.visibility === 'private' ? 'public' : 'private'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm aj-danger"
                      disabled={busyId === job._id}
                      onClick={() => remove(job)}
                      aria-label="Delete job"
                    >
                      <ion-icon name="trash-outline" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  )
}
