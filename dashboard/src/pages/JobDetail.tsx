import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import DOMPurify from 'dompurify'
import type { Job } from '@job-hunter/shared'
import { apiFetch } from '../api/client'
import { Header } from '../components/Header'
import { FormError } from '../components/FormError'

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

export function JobDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [job, setJob] = useState<Job | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    apiFetch(`/jobs/${id}`).then(async (res) => {
      if (!res.ok) {
        setError(res.status === 404 ? 'Job not found.' : 'Failed to load job.')
        return
      }
      setJob(await res.json())
    })
  }, [id])

  return (
    <div className="min-h-screen bg-slate-50">
      <Header />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <Link to="/jobs" className="text-sm text-blue-600 hover:underline">
          ← Back to jobs
        </Link>

        {error && (
          <div className="mt-4">
            <FormError message={error} />
          </div>
        )}

        {!job && !error ? (
          <p className="mt-4 text-sm text-slate-500">Loading…</p>
        ) : job ? (
          <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-8">
            <h1 className="text-lg font-semibold text-slate-900">{job.title}</h1>
            <p className="mt-1 text-sm text-slate-500">
              {job.company} · {job.location ?? 'Location unknown'}
            </p>

            <dl className="mt-6 grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-slate-500">Status</dt>
                <dd className="text-slate-900">{job.status}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Salary</dt>
                <dd className="text-slate-900">{formatSalary(job)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Source</dt>
                <dd className="text-slate-900">{job.sourceId}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Posted</dt>
                <dd className="text-slate-900">{formatDate(job.postedAt)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Discovered</dt>
                <dd className="text-slate-900">{formatDate(job.discoveredAt)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Verified</dt>
                <dd className="text-slate-900">{formatDate(job.verifiedAt)}</dd>
              </div>
            </dl>

            {job.verificationEvidence && (
              <div className="mt-6">
                <h2 className="text-sm font-medium text-slate-700">Verification evidence</h2>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">
                  {job.verificationEvidence}
                </p>
              </div>
            )}

            <div className="mt-6">
              <h2 className="text-sm font-medium text-slate-700">Description</h2>
              <div
                className="mt-1 whitespace-pre-wrap text-sm text-slate-600"
                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(job.rawDescription) }}
              />
            </div>

            <a
              href={job.normalizedUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-6 inline-block text-sm text-blue-600 hover:underline"
            >
              View original posting →
            </a>
          </div>
        ) : null}
      </main>
    </div>
  )
}
