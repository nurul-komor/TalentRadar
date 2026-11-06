import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Job } from '@job-hunter/shared'
import { apiFetch } from '../api/client'
import { ScoreRing } from '../components/ScoreRing'
import { Pill } from '../components/Pill'
import { FormError } from '../components/FormError'
import { useSavedJobs } from '../hooks/useSavedJobs'

const SUGGESTIONS_LIMIT = 20
const DESCRIPTION_PREVIEW_LENGTH = 220

interface Suggestion {
  job: Job & { _id: string }
  semanticScore: number
  ruleScore: number | null
  finalScore: number
}

interface SuggestionsResponseBody {
  suggestions: Suggestion[]
  semanticUnavailable: boolean
}

function formatSalary(salary: { salaryMin: number | null; salaryMax: number | null }): string {
  const { salaryMin, salaryMax } = salary
  if (salaryMin == null && salaryMax == null) return '—'
  if (salaryMin != null && salaryMax != null) {
    return `$${salaryMin.toLocaleString()} – $${salaryMax.toLocaleString()}`
  }
  return `$${(salaryMin ?? salaryMax)?.toLocaleString()}`
}

function descriptionPreview(rawDescription: string): string {
  const plainText = rawDescription.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  if (plainText.length <= DESCRIPTION_PREVIEW_LENGTH) return plainText
  return `${plainText.slice(0, DESCRIPTION_PREVIEW_LENGTH).trimEnd()}…`
}

export function SuggestionsPage() {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [semanticUnavailable, setSemanticUnavailable] = useState(false)
  const [loading, setLoading] = useState(true)
  // When the API has no embeddings configured the /suggestions route isn't mounted
  // (404), so the feature is simply unavailable rather than broken.
  const [featureDisabled, setFeatureDisabled] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { isSaved, toggleSaved } = useSavedJobs()
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    apiFetch(`/suggestions?limit=${SUGGESTIONS_LIMIT}`)
      .then(async (res) => {
        if (cancelled) return
        if (res.status === 404) {
          setFeatureDisabled(true)
          return
        }
        if (!res.ok) {
          setError('Failed to load suggestions.')
          return
        }
        const body: SuggestionsResponseBody = await res.json()
        setSuggestions(body.suggestions)
        setSemanticUnavailable(body.semanticUnavailable)
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load suggestions.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  function handleToggleSaved(jobId: string) {
    const willBeSaved = !isSaved(jobId)
    toggleSaved(jobId)
    setToastMessage(willBeSaved ? 'Saved' : 'Removed')
    setTimeout(() => setToastMessage(null), 1800)
  }

  return (
    <>
      <header className="page-head">
        <div className="wrap">
          <div className="kicker">For you</div>
          <h1>Suggested jobs</h1>
          <p>
            Ranked by how closely each role matches your resume and skills, blended with your
            fit score. Keep your resume up to date for sharper suggestions.
          </p>
        </div>
      </header>

      <section className="page-pad">
        <div className="wrap">
          {error && (
            <div className="mb-4">
              <FormError message={error} />
            </div>
          )}

          {loading ? (
            <div className="skeleton" aria-hidden="true">
              <div className="sk" style={{ width: 40, height: 40, borderRadius: '50%' }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div className="sk" style={{ width: '46%' }} />
                <div className="sk" style={{ width: '30%' }} />
              </div>
            </div>
          ) : featureDisabled ? (
            <p className="saved-empty">
              <b>Suggestions aren't available yet.</b>
              Semantic matching isn't configured on this server.
            </p>
          ) : semanticUnavailable ? (
            <p className="saved-empty">
              <b>Add your resume to get suggestions.</b>
              Upload a CV or fill in your resume so we can match jobs to your skills.
              <Link to="/cv" className="btn btn-indigo btn-sm" style={{ marginTop: 12 }}>
                Add your resume
              </Link>
            </p>
          ) : suggestions.length === 0 ? (
            <p className="saved-empty">
              <b>No suggestions yet.</b>
              Once more jobs are indexed we'll surface the best matches for you here.
            </p>
          ) : (
            suggestions.map(({ job, semanticScore, ruleScore, finalScore }) => (
              <article key={job._id} className="jrow">
                <ScoreRing score={Math.round(finalScore)} />
                <div className="main">
                  <div className="title">
                    <Link to={`/jobs/${job._id}`}>{job.title}</Link>
                  </div>
                  <div className="sub">
                    <ion-icon name="business-outline" style={{ fontSize: 12, display: 'inline-block', verticalAlign: 'middle', marginRight: 4 }} />
                    {job.company}
                    {job.location ? ` · ${job.location}` : ''}
                  </div>
                  <div className="tags">
                    <Pill tone="verified">{Math.round(semanticScore)}% skills match</Pill>
                    {ruleScore != null && <Pill tone="mono">{ruleScore} fit score</Pill>}
                    <Pill tone="mono">{formatSalary(job)}</Pill>
                  </div>
                  <p style={{ marginTop: 10, fontSize: 13.5, color: 'var(--fg-2)', lineHeight: 1.6 }}>
                    {descriptionPreview(job.rawDescription)}
                  </p>
                  <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <Link to={`/jobs/${job._id}`} className="btn btn-ghost">
                      View details
                    </Link>
                    <a href={job.normalizedUrl} target="_blank" rel="noreferrer" className="btn btn-indigo">
                      Apply
                    </a>
                  </div>
                </div>
                <div className="side">
                  <button
                    type="button"
                    className={`save-btn${isSaved(job._id) ? ' saved' : ''}`}
                    aria-pressed={isSaved(job._id)}
                    aria-label={isSaved(job._id) ? 'Remove from saved' : 'Save job'}
                    onClick={() => handleToggleSaved(job._id)}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
                      <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" />
                    </svg>
                  </button>
                </div>
              </article>
            ))
          )}
        </div>
      </section>
      <div className={`toast${toastMessage ? ' show' : ''}`}>{toastMessage}</div>
    </>
  )
}
