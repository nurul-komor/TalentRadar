import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Building2, CircleCheck, MapPin, Search, SlidersHorizontal, Wallet, X } from 'lucide-react'
import type { Job, JobSourceId } from '@job-hunter/shared'
import { apiFetch } from '../api/client'
import { PublicNav } from '../components/Nav'
import { Footer } from '../components/Footer'
import { Button } from '../components/Button'
import { FormError } from '../components/FormError'
import { ScoreRing } from '../components/ScoreRing'
import { Pill } from '../components/Pill'
import { useSavedJobs } from '../hooks/useSavedJobs'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../components/ui/accordion'
import { Checkbox } from '../components/ui/checkbox'
import {
  Drawer,
  DrawerBody,
  DrawerClose,
  DrawerFooter,
  DrawerHeader,
  DrawerPortal,
  DrawerTitle,
  DrawerTrigger,
} from '../components/ui/drawer'

const PAGE_SIZE = 20
const DEBOUNCE_MS = 300

type CategoryFilter = 'all' | 'government' | 'private'
type SourceSelection = { kind: 'all' } | { kind: 'source'; id: JobSourceId } | { kind: 'company'; name: string }
type DateFilter = 'all' | 'today' | 'week' | 'month'

const DATE_FILTER_OPTIONS: Array<{ value: Exclude<DateFilter, 'all'>; label: string; days: number }> = [
  { value: 'today', label: 'Past 24 hours', days: 1 },
  { value: 'week', label: 'Past week', days: 7 },
  { value: 'month', label: 'Past month', days: 30 },
]

function dateFilterCutoffIso(filter: DateFilter): string | undefined {
  const option = DATE_FILTER_OPTIONS.find((o) => o.value === filter)
  if (!option) return undefined
  return new Date(Date.now() - option.days * 24 * 60 * 60 * 1000).toISOString()
}


const SOURCE_OPTIONS: Array<{ value: JobSourceId; label: string }> = [
  { value: 'remoteok', label: 'Remote OK' },
  { value: 'weworkremotely', label: 'We Work Remotely' },
  { value: 'himalayas', label: 'Himalayas' },
  { value: 'teletalk-govt', label: 'alljobs.teletalk.com.bd (Govt)' },
  { value: 'brainstation-23', label: 'Brain Station 23' },
  { value: 'riseup-labs', label: 'Riseup Labs' },
  { value: 'enosis', label: 'Enosis Solutions' },
  { value: 'bdtask', label: 'Bdtask' },
  { value: 'selise', label: 'SELISE Digital Platforms' },
  { value: 'bjit', label: 'BJIT Limited' },
  { value: 'cefalo', label: 'Cefalo Bangladesh' },
  { value: 'vivasoft', label: 'Vivasoft Limited' },
  { value: 'dsinnovators', label: 'Dynamic Solution Innovators' },
]

const SOURCE_LABELS: Record<JobSourceId, string> = Object.fromEntries(
  SOURCE_OPTIONS.map((option) => [option.value, option.label]),
) as Record<JobSourceId, string>

function parseSourceSelection(searchParams: URLSearchParams): SourceSelection {
  const sourceId = searchParams.get('sourceId')
  if (sourceId) return { kind: 'source', id: sourceId as JobSourceId }
  const companyName = searchParams.get('company')
  if (companyName) return { kind: 'company', name: companyName }
  return { kind: 'all' }
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}

interface JobsResponseBody {
  jobs: Array<Job & { _id: string }>
  total: number
}

interface TrackedCompany {
  name: string
  website: string
  careersUrl: string
  atsType: string
  verified: boolean
  notes?: string
}

interface SeedCompaniesResponseBody {
  companies: TrackedCompany[]
}

function relativeTimeFromNow(dateString: string): string {
  const diffSeconds = Math.round((Date.now() - new Date(dateString).getTime()) / 1000)
  const diffMinutes = Math.round(diffSeconds / 60)
  const diffHours = Math.round(diffMinutes / 60)
  const diffDays = Math.round(diffHours / 24)

  if (diffSeconds < 60) return 'just now'
  if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`
  if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`
  if (diffDays < 30) {
    const diffWeeks = Math.round(diffDays / 7)
    return `${diffWeeks} week${diffWeeks === 1 ? '' : 's'} ago`
  }
  if (diffDays < 365) {
    const diffMonths = Math.round(diffDays / 30)
    return `${diffMonths} month${diffMonths === 1 ? '' : 's'} ago`
  }
  const diffYears = Math.round(diffDays / 365)
  return `${diffYears} year${diffYears === 1 ? '' : 's'} ago`
}

function statusBadgeLabel(job: Job): string {
  return job.status === 'discovered' ? relativeTimeFromNow(job.discoveredAt) : job.status
}

function formatSalary(job: Job): string {
  if (job.salaryMin == null && job.salaryMax == null) return '—'
  if (job.salaryMin != null && job.salaryMax != null) {
    return `$${job.salaryMin.toLocaleString()} – $${job.salaryMax.toLocaleString()}`
  }
  return `$${(job.salaryMin ?? job.salaryMax)?.toLocaleString()}`
}

const DESCRIPTION_PREVIEW_LENGTH = 220
const REQUIREMENTS_PREVIEW_LENGTH = 500
const REQUIREMENTS_HEADING_PATTERN = /requirement|qualification|\bbring\b|who you are|about you|nice to have/i

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength).trimEnd()}…`
}

function descriptionPreview(rawDescription: string): string {
  const plainText = rawDescription.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  return truncate(plainText, DESCRIPTION_PREVIEW_LENGTH)
}

function requirementsPreview(rawDescription: string): string | null {
  const doc = new DOMParser().parseFromString(rawDescription, 'text/html')
  const headings = Array.from(doc.querySelectorAll('h1, h2, h3, h4, h5, h6'))
  const match = headings.find((heading) => REQUIREMENTS_HEADING_PATTERN.test(heading.textContent ?? ''))
  if (!match) return null

  const textParts: string[] = []
  for (let node = match.nextElementSibling; node && !/^H[1-6]$/.test(node.tagName); node = node.nextElementSibling) {
    const text = node.textContent?.trim()
    if (text) textParts.push(text)
  }

  const plainText = textParts.join(' ').replace(/\s+/g, ' ').trim()
  return plainText ? truncate(plainText, REQUIREMENTS_PREVIEW_LENGTH) : null
}

export function JobsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [jobs, setJobs] = useState<Array<Job & { _id: string }>>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [trackedCompanies, setTrackedCompanies] = useState<TrackedCompany[]>([])

  const category = (searchParams.get('category') as CategoryFilter) || 'all'
  const sourceSelection = parseSourceSelection(searchParams)
  const sourceSelectionKey =
    sourceSelection.kind === 'source'
      ? `source:${sourceSelection.id}`
      : sourceSelection.kind === 'company'
        ? `company:${sourceSelection.name}`
        : 'all'
  const datePosted = (searchParams.get('datePosted') as DateFilter) || 'all'
  const offset = Math.max(0, Number(searchParams.get('offset')) || 0)

  const [keyword, setKeyword] = useState(searchParams.get('q') ?? '')
  const [location, setLocation] = useState(searchParams.get('location') ?? '')
  const [salaryMin, setSalaryMin] = useState(searchParams.get('salaryMin') ?? '')
  const [salaryMax, setSalaryMax] = useState(searchParams.get('salaryMax') ?? '')

  const urlKeyword = searchParams.get('q') ?? ''
  const urlLocation = searchParams.get('location') ?? ''
  const urlSalaryMin = searchParams.get('salaryMin') ?? ''
  const urlSalaryMax = searchParams.get('salaryMax') ?? ''

  useEffect(() => setKeyword(urlKeyword), [urlKeyword])
  useEffect(() => setLocation(urlLocation), [urlLocation])
  useEffect(() => setSalaryMin(urlSalaryMin), [urlSalaryMin])
  useEffect(() => setSalaryMax(urlSalaryMax), [urlSalaryMax])

  const debouncedKeyword = useDebouncedValue(keyword, DEBOUNCE_MS)
  const debouncedLocation = useDebouncedValue(location, DEBOUNCE_MS)
  const debouncedSalaryMin = useDebouncedValue(salaryMin, DEBOUNCE_MS)
  const debouncedSalaryMax = useDebouncedValue(salaryMax, DEBOUNCE_MS)

  const activeFilterCount =
    Number(category !== 'all') +
    Number(sourceSelection.kind !== 'all') +
    Number(datePosted !== 'all') +
    Number(keyword.trim() !== '') +
    Number(location.trim() !== '') +
    Number(salaryMin.trim() !== '' || salaryMax.trim() !== '')
  const hasActiveFilters = activeFilterCount > 0

  function updateFilters(updates: Record<string, string | null>, opts: { resetOffset?: boolean } = {}) {
    const resetOffset = opts.resetOffset ?? true
    const next = new URLSearchParams(searchParams)
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === '') next.delete(key)
      else next.set(key, value)
    }
    if (resetOffset) next.delete('offset')
    setSearchParams(next, { replace: true })
  }

  function clearFilters() {
    setSearchParams(new URLSearchParams(), { replace: true })
  }

  useEffect(() => {
    fetch('/data/seed-companies-bd.json')
      .then((res) => (res.ok ? (res.json() as Promise<SeedCompaniesResponseBody>) : null))
      .then((data) => setTrackedCompanies(data?.companies ?? []))
      .catch(() => setTrackedCompanies([]))
  }, [])

  useEffect(() => {
    if (debouncedKeyword === urlKeyword) return
    updateFilters({ q: debouncedKeyword || null })
  }, [debouncedKeyword])

  useEffect(() => {
    if (debouncedLocation === urlLocation) return
    updateFilters({ location: debouncedLocation || null })
  }, [debouncedLocation])

  useEffect(() => {
    if (debouncedSalaryMin === urlSalaryMin) return
    updateFilters({ salaryMin: debouncedSalaryMin || null })
  }, [debouncedSalaryMin])

  useEffect(() => {
    if (debouncedSalaryMax === urlSalaryMax) return
    updateFilters({ salaryMax: debouncedSalaryMax || null })
  }, [debouncedSalaryMax])

  useEffect(() => {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) })
    if (category !== 'all') params.set('category', category)
    if (sourceSelection.kind === 'source') params.set('sourceId', sourceSelection.id)
    if (sourceSelection.kind === 'company') params.set('company', sourceSelection.name)
    const discoveredAfter = dateFilterCutoffIso(datePosted)
    if (discoveredAfter) params.set('discoveredAfter', discoveredAfter)
    if (debouncedKeyword.trim()) params.set('q', debouncedKeyword.trim())
    if (debouncedLocation.trim()) params.set('location', debouncedLocation.trim())
    if (debouncedSalaryMin.trim()) params.set('salaryMin', debouncedSalaryMin.trim())
    if (debouncedSalaryMax.trim()) params.set('salaryMax', debouncedSalaryMax.trim())

    apiFetch(`/jobs?${params.toString()}`)
      .then(async (res) => {
        if (!res.ok) {
          setError('Failed to load jobs.')
          return
        }
        const data: JobsResponseBody = await res.json()
        setJobs(data.jobs)
        setTotal(data.total)
      })
      .finally(() => setLoading(false))
  }, [category, sourceSelectionKey, datePosted, debouncedKeyword, debouncedLocation, debouncedSalaryMin, debouncedSalaryMax, offset])

  const rangeStart = total === 0 ? 0 : offset + 1
  const rangeEnd = Math.min(offset + PAGE_SIZE, total)

  const filterControls = (
    <div className="filter-rail">
      <div className="relative mt-4">
        <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          placeholder="Title or company"
          className="w-full rounded-full border border-input bg-background py-2.5 pl-10 pr-3 text-sm text-foreground"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
      </div>

      <Accordion defaultValue={['date', 'source']}>
            <AccordionItem value="date">
              <AccordionTrigger>Date posted</AccordionTrigger>
              <AccordionContent>
                <div className="flex flex-col gap-2">
                  {DATE_FILTER_OPTIONS.map((option) => (
                    <label key={option.value} className="check">
                      <Checkbox
                        checked={datePosted === option.value}
                        onCheckedChange={(checked) =>
                          updateFilters({ datePosted: checked ? option.value : null })
                        }
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="source">
              <AccordionTrigger>Source</AccordionTrigger>
              <AccordionContent>
                <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto">
                  {SOURCE_OPTIONS.map((option) => (
                    <li key={option.value}>
                      <label className="check">
                        <Checkbox
                          checked={sourceSelection.kind === 'source' && sourceSelection.id === option.value}
                          onCheckedChange={(checked) =>
                            updateFilters({ sourceId: checked ? option.value : null, company: null })
                          }
                        />
                        {option.label}
                      </label>
                    </li>
                  ))}
                  {trackedCompanies.map((trackedCompany) => (
                    <li key={trackedCompany.name} className="flex items-center justify-between gap-2">
                      <label className="check">
                        <Checkbox
                          checked={sourceSelection.kind === 'company' && sourceSelection.name === trackedCompany.name}
                          onCheckedChange={(checked) =>
                            updateFilters({ company: checked ? trackedCompany.name : null, sourceId: null })
                          }
                        />
                        {trackedCompany.name}
                      </label>
                      {trackedCompany.verified && (
                        <CircleCheck size={14} className="shrink-0 text-green-600" aria-label="Verified" />
                      )}
                    </li>
                  ))}
                </ul>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="location">
              <AccordionTrigger>Location</AccordionTrigger>
              <AccordionContent>
                <input
                  type="text"
                  placeholder="e.g. Europe"
                  className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                />
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="salary">
              <AccordionTrigger>Salary</AccordionTrigger>
              <AccordionContent>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    placeholder="Min"
                    className="w-full min-w-0 rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground"
                    value={salaryMin}
                    onChange={(e) => setSalaryMin(e.target.value)}
                  />
                  <span className="text-muted-foreground">–</span>
                  <input
                    type="number"
                    min={0}
                    placeholder="Max"
                    className="w-full min-w-0 rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground"
                    value={salaryMax}
                    onChange={(e) => setSalaryMax(e.target.value)}
                  />
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
    </div>
  )

  const jobsCountLabel = loading ? 'Searching…' : `${total.toLocaleString()} jobs found`
  const { isSaved, toggleSaved } = useSavedJobs()

  const [toastMessage, setToastMessage] = useState<string | null>(null)

  function handleToggleSaved(jobId: string) {
    const willBeSaved = !isSaved(jobId)
    toggleSaved(jobId)
    setToastMessage(willBeSaved ? 'Saved' : 'Removed')
    setTimeout(() => setToastMessage(null), 1800)
  }

  return (
    <div>
      <PublicNav />
      <header className="page-head">
        <div className="wrap">
          <div className="kicker">Job feed</div>
          <h1>Verified roles, scored for you.</h1>
          <p>Remote roles and Bangladesh government circulars, each re-checked against its source in the last 24 hours.</p>
          <div className="segment" role="tablist" aria-label="Job category">
            <button
              type="button"
              role="tab"
              className={`seg${category === 'all' ? ' on' : ''}`}
              aria-selected={category === 'all'}
              onClick={() => updateFilters({ category: null })}
            >
              All jobs
            </button>
            <button
              type="button"
              role="tab"
              className={`seg${category === 'government' ? ' on' : ''}`}
              aria-selected={category === 'government'}
              onClick={() => updateFilters({ category: 'government' })}
            >
              Government
            </button>
            <button
              type="button"
              role="tab"
              className={`seg${category === 'private' ? ' on' : ''}`}
              aria-selected={category === 'private'}
              onClick={() => updateFilters({ category: 'private' })}
            >
              Other jobs
            </button>
            {category === 'government' && (
              <span className="seg-note">
                Government circulars come from{' '}
                <a href="https://alljobs.teletalk.com.bd/jobs/government" target="_blank" rel="noopener noreferrer">
                  alljobs.teletalk.com.bd
                </a>
              </span>
            )}
          </div>
        </div>
      </header>
      <section className="page-pad">
        <div className="wrap listing">
          <aside className="hidden w-full shrink-0 lg:sticky lg:top-24 lg:block lg:w-72">
            <div className="flex items-center justify-between">
              <span className="count">
                <b>{jobsCountLabel}</b>
              </span>
              <button type="button" onClick={clearFilters} disabled={!hasActiveFilters} className="clear-all">
                <X size={14} style={{ display: 'inline', marginRight: 4 }} />
                Clear filters
              </button>
            </div>
            {filterControls}
          </aside>

          <Drawer>
            <div className="flex w-full items-center justify-between gap-2 lg:hidden">
              <span className="count">
                <b>{jobsCountLabel}</b>
              </span>
              <div className="flex items-center gap-3">
                <DrawerTrigger className="btn btn-ghost">
                  <SlidersHorizontal size={14} />
                  Filters
                  {activeFilterCount > 0 && <span className="pill mono">{activeFilterCount}</span>}
                </DrawerTrigger>
                <button type="button" onClick={clearFilters} disabled={!hasActiveFilters} className="clear-all">
                  Clear
                </button>
              </div>
            </div>
            <DrawerPortal>
              <DrawerHeader>
                <DrawerTitle>Filters</DrawerTitle>
                <DrawerClose />
              </DrawerHeader>
              <DrawerBody>{filterControls}</DrawerBody>
              <DrawerFooter>
                <button type="button" onClick={clearFilters} disabled={!hasActiveFilters} className="clear-all">
                  Clear filters
                </button>
                <DrawerClose className="btn btn-indigo">Done</DrawerClose>
              </DrawerFooter>
            </DrawerPortal>
          </Drawer>

          <div className="results">
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
            ) : jobs.length === 0 ? (
              <p className="saved-empty">
                <b>No jobs found.</b>
                Try widening your filters.
              </p>
            ) : (
              jobs.map((job) => {
                const requirements = requirementsPreview(job.rawDescription)
                return (
                  <article key={job._id} className="jrow" style={{ gridTemplateColumns: 'auto minmax(0,1fr) auto' }}>
                    <ScoreRing score={job.score ?? 0} />
                    <div className="main">
                      <div className="title">
                        <Link to={`/jobs/${job._id}`}>{job.title}</Link>
                      </div>
                      <div className="sub">
                        <Building2 size={12} style={{ display: 'inline', marginRight: 4 }} />
                        {job.company}
                        {job.location ? ` · ${job.location}` : ''}
                      </div>
                      <div className="tags">
                        {job.status === 'verified' && <Pill tone="verified">Verified</Pill>}
                        {job.sourceId === 'teletalk-govt' && <Pill tone="govt">Government</Pill>}
                        <Pill tone="mono">{formatSalary(job)}</Pill>
                        <Pill tone="mono">{SOURCE_LABELS[job.sourceId]}</Pill>
                      </div>
                      <p style={{ marginTop: 10, fontSize: 13.5, color: 'var(--fg-2)', lineHeight: 1.6 }}>
                        {descriptionPreview(job.rawDescription)}
                      </p>
                      {requirements && (
                        <p style={{ marginTop: 8, fontSize: 13, color: 'var(--muted-text)', lineHeight: 1.6 }}>
                          {requirements}
                        </p>
                      )}
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
                      <span className="when">{statusBadgeLabel(job)}</span>
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
                )
              })
            )}

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2" style={{ color: 'var(--muted-text)', fontSize: 13 }}>
              <span>{total === 0 ? 'No results' : `Showing ${rangeStart}–${rangeEnd} of ${total}`}</span>
              <div className="pager">
                <button
                  type="button"
                  disabled={offset === 0}
                  onClick={() => updateFilters({ offset: String(Math.max(0, offset - PAGE_SIZE)) }, { resetOffset: false })}
                >
                  Prev
                </button>
                <button
                  type="button"
                  disabled={offset + PAGE_SIZE >= total}
                  onClick={() => updateFilters({ offset: String(offset + PAGE_SIZE) }, { resetOffset: false })}
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
      <Footer />
      <div className={`toast${toastMessage ? ' show' : ''}`}>{toastMessage}</div>
    </div>
  )
}
