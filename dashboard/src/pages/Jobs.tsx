import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Building2, CircleCheck, MapPin, Search, SlidersHorizontal, Wallet, X } from 'lucide-react'
import type { Job, JobSourceId, JobStatus } from '@job-hunter/shared'
import { apiFetch } from '../api/client'
import { Header } from '../components/Header'
import { Button } from '../components/Button'
import { FormError } from '../components/FormError'
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

type StatusFilter = JobStatus | 'all'
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

const STATUS_OPTIONS: Array<{ value: JobStatus; label: string }> = [
  { value: 'discovered', label: 'Discovered' },
  { value: 'verified', label: 'Verified' },
  { value: 'rejected', label: 'Rejected' },
]

const SOURCE_OPTIONS: Array<{ value: JobSourceId; label: string }> = [
  { value: 'remoteok', label: 'Remote OK' },
  { value: 'weworkremotely', label: 'We Work Remotely' },
  { value: 'himalayas', label: 'Himalayas' },
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

function statusBadgeClasses(status: JobStatus): string {
  switch (status) {
    case 'verified':
      return 'bg-green-100 text-green-700'
    case 'rejected':
      return 'bg-red-100 text-red-700'
    default:
      return 'bg-slate-100 text-slate-600'
  }
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

  const status = (searchParams.get('status') as StatusFilter) || 'all'
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
    Number(status !== 'all') +
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
    if (status !== 'all') params.set('status', status)
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
  }, [status, sourceSelectionKey, datePosted, debouncedKeyword, debouncedLocation, debouncedSalaryMin, debouncedSalaryMax, offset])

  const rangeStart = total === 0 ? 0 : offset + 1
  const rangeEnd = Math.min(offset + PAGE_SIZE, total)

  const filterControls = (
    <>
      <div className="relative mt-4">
        <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          placeholder="Title or company"
          className="w-full rounded-full border border-slate-300 py-2.5 pl-10 pr-3 text-sm"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
      </div>

      <Accordion defaultValue={['date', 'status', 'source']} className="mt-4 divide-y divide-slate-200 border-t border-b border-slate-200">
            <AccordionItem value="date">
              <AccordionTrigger className="text-sm font-medium text-slate-900">Date posted</AccordionTrigger>
              <AccordionContent>
                <div className="flex flex-col gap-2">
                  {DATE_FILTER_OPTIONS.map((option) => (
                    <label key={option.value} className="flex items-center gap-2 text-sm text-slate-700">
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

            <AccordionItem value="status">
              <AccordionTrigger className="text-sm font-medium text-slate-900">Status</AccordionTrigger>
              <AccordionContent>
                <div className="flex flex-col gap-2">
                  {STATUS_OPTIONS.map((option) => (
                    <label key={option.value} className="flex items-center gap-2 text-sm text-slate-700">
                      <Checkbox
                        checked={status === option.value}
                        onCheckedChange={(checked) => updateFilters({ status: checked ? option.value : null })}
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="source">
              <AccordionTrigger className="text-sm font-medium text-slate-900">Source</AccordionTrigger>
              <AccordionContent>
                <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto">
                  {SOURCE_OPTIONS.map((option) => (
                    <li key={option.value}>
                      <label className="flex items-center gap-2 text-sm text-slate-700">
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
                      <label className="flex items-center gap-2 text-sm text-slate-700">
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
              <AccordionTrigger className="text-sm font-medium text-slate-900">Location</AccordionTrigger>
              <AccordionContent>
                <input
                  type="text"
                  placeholder="e.g. Europe"
                  className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                />
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="salary">
              <AccordionTrigger className="text-sm font-medium text-slate-900">Salary</AccordionTrigger>
              <AccordionContent>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    placeholder="Min"
                    className="w-full min-w-0 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                    value={salaryMin}
                    onChange={(e) => setSalaryMin(e.target.value)}
                  />
                  <span className="text-slate-400">–</span>
                  <input
                    type="number"
                    min={0}
                    placeholder="Max"
                    className="w-full min-w-0 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                    value={salaryMax}
                    onChange={(e) => setSalaryMax(e.target.value)}
                  />
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
    </>
  )

  const jobsCountLabel = loading ? 'Searching…' : `${total.toLocaleString()} jobs found`

  return (
    <div className="min-h-screen bg-slate-50">
      <Header />
      <main className="mx-auto flex max-w-7xl flex-col items-start gap-6 px-4 py-8 lg:flex-row lg:gap-10">
        <aside className="hidden w-full shrink-0 lg:sticky lg:top-8 lg:block lg:w-72">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-slate-900">{jobsCountLabel}</p>
            <button
              type="button"
              onClick={clearFilters}
              disabled={!hasActiveFilters}
              className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline disabled:pointer-events-none disabled:text-slate-300"
            >
              <X size={14} />
              Clear filters
            </button>
          </div>
          {filterControls}
        </aside>

        <Drawer>
          <div className="flex w-full items-center justify-between gap-2 lg:hidden">
            <p className="text-sm font-medium text-slate-900">{jobsCountLabel}</p>
            <div className="flex items-center gap-3">
              <DrawerTrigger className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
                <SlidersHorizontal size={14} />
                Filters
                {activeFilterCount > 0 && (
                  <span className="inline-flex size-5 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white">
                    {activeFilterCount}
                  </span>
                )}
              </DrawerTrigger>
              <button
                type="button"
                onClick={clearFilters}
                disabled={!hasActiveFilters}
                className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline disabled:pointer-events-none disabled:text-slate-300"
              >
                <X size={14} />
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
              <button
                type="button"
                onClick={clearFilters}
                disabled={!hasActiveFilters}
                className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline disabled:pointer-events-none disabled:text-slate-300"
              >
                <X size={14} />
                Clear filters
              </button>
              <DrawerClose className="ml-auto inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-500">
                Done
              </DrawerClose>
            </DrawerFooter>
          </DrawerPortal>
        </Drawer>

        <section className="w-full min-w-0 flex-1">
          {error && (
            <div className="mb-4">
              <FormError message={error} />
            </div>
          )}

          {loading ? (
            <p className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
              Loading…
            </p>
          ) : jobs.length === 0 ? (
            <p className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
              No jobs found.
            </p>
          ) : (
            <ul className="flex flex-col gap-4">
              {jobs.map((job) => {
                const requirements = requirementsPreview(job.rawDescription)
                return (
                <li
                  key={job._id}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-5 sm:px-6"
                >
                  <div className="flex items-start justify-between gap-4">
                    <Link
                      to={`/jobs/${job._id}`}
                      className="text-xl font-normal text-slate-900 hover:underline"
                    >
                      {job.title}
                    </Link>
                    <span
                      className={`mt-1 shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClasses(job.status)}`}
                    >
                      {statusBadgeLabel(job)}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
                    <span className="inline-flex items-center gap-1.5">
                      <Building2 size={16} className="text-slate-400" />
                      {job.company}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <MapPin size={16} className="text-slate-400" />
                      {job.location ?? '—'}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <Wallet size={16} className="text-slate-400" />
                      {formatSalary(job)}
                    </span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                      {SOURCE_LABELS[job.sourceId]}
                    </span>
                  </div>

                  <div className="mt-4 border-t border-slate-200 pt-4">
                    <h3 className="text-sm font-semibold text-slate-900">Description</h3>
                    <p className="mt-2 text-sm text-slate-600">{descriptionPreview(job.rawDescription)}</p>

                    {requirements && (
                      <div className="mt-4">
                        <h3 className="text-sm font-semibold text-slate-900">Requirements</h3>
                        <p className="mt-2 text-sm text-slate-600">{requirements}</p>
                      </div>
                    )}

                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <Link
                        to={`/jobs/${job._id}`}
                        className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-1.5 text-sm font-semibold text-blue-600 shadow-sm hover:bg-slate-50"
                      >
                        View details
                      </Link>
                      <a
                        href={job.normalizedUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-500"
                      >
                        Apply
                      </a>
                    </div>
                  </div>
                </li>
                )
              })}
            </ul>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-500">
            <span>
              {total === 0 ? 'No results' : `Showing ${rangeStart}–${rangeEnd} of ${total}`}
            </span>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                disabled={offset === 0}
                onClick={() => updateFilters({ offset: String(Math.max(0, offset - PAGE_SIZE)) }, { resetOffset: false })}
              >
                Prev
              </Button>
              <Button
                variant="secondary"
                disabled={offset + PAGE_SIZE >= total}
                onClick={() => updateFilters({ offset: String(offset + PAGE_SIZE) }, { resetOffset: false })}
              >
                Next
              </Button>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
