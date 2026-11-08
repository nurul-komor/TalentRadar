import { Icon } from '../components/Icon'
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import type { Job, JobSourceId, UserJob } from '@job-hunter/shared'
import { apiFetch } from '../api/client'
import { useAuth } from '../auth/AuthContext'
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

type CategoryFilter = 'all' | 'government' | 'mine' | 'private'
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
  { value: 'adzuna', label: 'Adzuna' },
]

const SOURCE_LABELS: Record<JobSourceId, string> = Object.fromEntries(
  SOURCE_OPTIONS.map((option) => [option.value, option.label]),
) as Record<JobSourceId, string>

// Every tracked company in seed-companies-bd.json (Brain Station 23, BJIT, …) is
// also a dedicated source above with the same display name, so it would appear
// twice in the Source filter — once as a source, once as a company. Skip any
// tracked company whose name already matches a source label.
const SOURCE_LABEL_SET = new Set(SOURCE_OPTIONS.map((option) => option.label))

// Programming-language filter. Values are the stable keys the API understands
// (see LANGUAGE_PATTERNS in api/src/routes/jobs.ts); selecting several matches
// any of them.
const LANGUAGE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'python', label: 'Python' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'java', label: 'Java' },
  { value: 'go', label: 'Go (Golang)' },
  { value: 'csharp', label: 'C#' },
  { value: 'php', label: 'PHP' },
  { value: 'cpp', label: 'C++' },
  { value: 'kotlin', label: 'Kotlin' },
  { value: 'rust', label: 'Rust' },
]

function parseLanguages(searchParams: URLSearchParams): string[] {
  const raw = searchParams.get('languages')
  if (!raw) return []
  const valid = new Set(LANGUAGE_OPTIONS.map((option) => option.value))
  return [...new Set(raw.split(',').map((value) => value.trim()).filter((value) => valid.has(value)))]
}

// Regex per language, mirroring LANGUAGE_PATTERNS in api/src/routes/jobs.ts.
// Used to apply the language filter to the user's own added jobs, which are
// fetched client-side and so aren't covered by the server-side jobs query.
const LANGUAGE_MATCHERS: Record<string, string> = {
  python: '\\bpython\\b',
  typescript: '\\btypescript\\b',
  javascript: '\\bjavascript\\b',
  java: '\\bjava\\b',
  go: '\\b(?:golang|go)\\b',
  csharp: '(?:c#|\\bc[-\\s]?sharp\\b|\\.net\\b)',
  php: '\\bphp\\b',
  cpp: '(?:c\\+\\+|\\bcpp\\b)',
  kotlin: '\\bkotlin\\b',
  rust: '\\brust\\b',
}

// True when a user-added job mentions ANY of the selected languages in its
// title, description, or location. An empty selection matches everything.
function userJobMatchesLanguages(job: UserJob, languages: string[]): boolean {
  if (languages.length === 0) return true
  const pattern = languages.map((key) => LANGUAGE_MATCHERS[key]).filter(Boolean).join('|')
  if (!pattern) return true
  const haystack = `${job.title}\n${job.description}\n${job.location ?? ''}`
  return new RegExp(pattern, 'i').test(haystack)
}

// Applies the keyword search to user-added jobs the same way the API does for the
// discovery feed (title/company/description), so searching narrows "My jobs" and
// saved jobs too — they're fetched client-side and bypass the server-side filter.
// A plain case-insensitive substring match (not regex) keeps user input literal.
function userJobMatchesKeyword(job: UserJob, keyword: string): boolean {
  const needle = keyword.trim().toLowerCase()
  if (!needle) return true
  const haystack = `${job.title}\n${job.company}\n${job.description}\n${job.location ?? ''}`
  return haystack.toLowerCase().includes(needle)
}

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

// matchScore is present only on responses from the "Best match" sort (sort=match); it's the
// semantic similarity (0–100) between the job and the signed-in user's resume.
type FeedJob = Job & { _id: string; matchScore?: number }

interface JobsResponseBody {
  jobs: FeedJob[]
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

function formatSalary(salary: { salaryMin: number | null; salaryMax: number | null }): string {
  const { salaryMin, salaryMax } = salary
  if (salaryMin == null && salaryMax == null) return '—'
  if (salaryMin != null && salaryMax != null) {
    return `$${salaryMin.toLocaleString()} – $${salaryMax.toLocaleString()}`
  }
  return `$${(salaryMin ?? salaryMax)?.toLocaleString()}`
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
  const { isAuthenticated } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [jobs, setJobs] = useState<FeedJob[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [trackedCompanies, setTrackedCompanies] = useState<TrackedCompany[]>([])
  const [myJobs, setMyJobs] = useState<UserJob[]>([])
  // Whether the signed-in user has a resume to match against — gates the "Best match" sort.
  const [hasResume, setHasResume] = useState(false)

  const { isSaved, toggleSaved, savedIds } = useSavedJobs()
  // "Saved jobs" mode (reached via /jobs?saved=1 from the sidebar) shows only
  // the jobs the user bookmarked. Saved ids live in localStorage, so this view
  // fetches them by id rather than going through the server-side filters.
  const savedMode = searchParams.get('saved') === '1'
  const savedKey = savedIds.join(',')

  const category = (searchParams.get('category') as CategoryFilter) || 'all'
  const sourceSelection = parseSourceSelection(searchParams)
  const sourceSelectionKey =
    sourceSelection.kind === 'source'
      ? `source:${sourceSelection.id}`
      : sourceSelection.kind === 'company'
        ? `company:${sourceSelection.name}`
        : 'all'
  const datePosted = (searchParams.get('datePosted') as DateFilter) || 'all'
  const selectedLanguages = parseLanguages(searchParams)
  const languagesKey = selectedLanguages.join(',')
  const offset = Math.max(0, Number(searchParams.get('offset')) || 0)

  // "Best match" semantic sort is only meaningful for a signed-in user with a resume, and not
  // in the saved / "my jobs" views (which aren't the discovery feed). The server falls back to
  // newest-first if it can't match, but we only surface the control when it will actually work.
  const canSortByMatch = isAuthenticated && hasResume && !savedMode && category !== 'mine'
  const sortByMatch = canSortByMatch && searchParams.get('sort') === 'match'

  const [keyword, setKeyword] = useState(searchParams.get('q') ?? '')
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  // Typeahead suggestions shown while typing in the search box.
  const [suggestions, setSuggestions] = useState<Job[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [activeSuggestion, setActiveSuggestion] = useState(-1)
  const [location, setLocation] = useState(searchParams.get('location') ?? '')
  const [salaryMin, setSalaryMin] = useState(searchParams.get('salaryMin') ?? '')
  const [salaryMax, setSalaryMax] = useState(searchParams.get('salaryMax') ?? '')

  const urlKeyword = searchParams.get('q') ?? ''
  const urlLocation = searchParams.get('location') ?? ''
  const urlSalaryMin = searchParams.get('salaryMin') ?? ''
  const urlSalaryMax = searchParams.get('salaryMax') ?? ''

  useEffect(() => setKeyword(urlKeyword), [urlKeyword])
  useEffect(() => setLocation(urlLocation), [urlLocation])

  // Press "/" anywhere (outside a text field) to jump to search — a common
  // power-user shortcut that makes the feed feel keyboard-driven.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return
      event.preventDefault()
      searchInputRef.current?.focus()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])
  useEffect(() => setSalaryMin(urlSalaryMin), [urlSalaryMin])
  useEffect(() => setSalaryMax(urlSalaryMax), [urlSalaryMax])

  const debouncedKeyword = useDebouncedValue(keyword, DEBOUNCE_MS)
  const debouncedLocation = useDebouncedValue(location, DEBOUNCE_MS)
  const debouncedSalaryMin = useDebouncedValue(salaryMin, DEBOUNCE_MS)
  const debouncedSalaryMax = useDebouncedValue(salaryMax, DEBOUNCE_MS)

  // Suggestions use a shorter debounce than the committed search so the dropdown
  // feels instant while typing, without firing a request on every keystroke.
  const suggestKeyword = useDebouncedValue(keyword, 160)
  // True while the typed term hasn't yet been committed to the URL/feed — drives
  // the little spinner in the search box.
  const searchPending = keyword.trim() !== '' && keyword !== urlKeyword

  useEffect(() => {
    const term = suggestKeyword.trim()
    if (term.length < 2) {
      setSuggestions([])
      return
    }
    let cancelled = false
    const params = new URLSearchParams({ q: term, limit: '6' })
    apiFetch(`/jobs?${params.toString()}`)
      .then((res) => (res.ok ? res.json() : { jobs: [] }))
      .then((body: { jobs: Job[] }) => {
        if (cancelled) return
        setSuggestions(body.jobs ?? [])
        setActiveSuggestion(-1)
      })
      .catch(() => {
        if (!cancelled) setSuggestions([])
      })
    return () => {
      cancelled = true
    }
  }, [suggestKeyword])

  function commitSuggestion(job: Job) {
    setShowSuggestions(false)
    if (job._id) navigate(`/jobs/${job._id}`)
  }

  function onSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (!showSuggestions || suggestions.length === 0) {
      if (event.key === 'Escape') setShowSuggestions(false)
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveSuggestion((index) => (index + 1) % suggestions.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveSuggestion((index) => (index <= 0 ? suggestions.length - 1 : index - 1))
    } else if (event.key === 'Enter') {
      if (activeSuggestion >= 0) {
        event.preventDefault()
        commitSuggestion(suggestions[activeSuggestion])
      }
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setShowSuggestions(false)
    }
  }

  function clearSearch() {
    setKeyword('')
    setSuggestions([])
    setShowSuggestions(false)
    searchInputRef.current?.focus()
  }

  const activeFilterCount =
    Number(savedMode) +
    Number(category !== 'all') +
    Number(sourceSelection.kind !== 'all') +
    Number(datePosted !== 'all') +
    Number(selectedLanguages.length > 0) +
    Number(keyword.trim() !== '') +
    Number(location.trim() !== '') +
    Number(salaryMin.trim() !== '' || salaryMax.trim() !== '')
  const hasActiveFilters = activeFilterCount > 0

  function toggleLanguage(value: string, checked: boolean) {
    const next = checked
      ? [...selectedLanguages, value]
      : selectedLanguages.filter((language) => language !== value)
    updateFilters({ languages: next.length ? next.join(',') : null })
  }

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

  // Jobs the signed-in user added themselves (from /add-job) live in a separate,
  // profile-scoped collection, so they're fetched here and shown above the public
  // feed. Logged-out visitors never see them.
  useEffect(() => {
    if (!isAuthenticated) {
      setMyJobs([])
      setHasResume(false)
      return
    }
    apiFetch('/user-jobs')
      .then((res) => (res.ok ? res.json() : { jobs: [] }))
      .then((body: { jobs: UserJob[] }) => setMyJobs(body.jobs))
      .catch(() => setMyJobs([]))
    // A resume (uploaded CV text or a non-empty structured resume) is what the "Best match"
    // sort ranks against. resumeEmbedding itself is projected out of the profile response, so
    // we infer eligibility from the resume content the server does return.
    apiFetch('/profile')
      .then((res) => (res.ok ? res.json() : null))
      .then((profile: { cvText?: string | null; resume?: { skillGroups?: unknown[] } } | null) => {
        const hasCv = Boolean(profile?.cvText && profile.cvText.trim())
        const hasSkills = Boolean(profile?.resume?.skillGroups && profile.resume.skillGroups.length > 0)
        setHasResume(hasCv || hasSkills)
      })
      .catch(() => setHasResume(false))
  }, [isAuthenticated])

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

    // Saved mode: fetch each bookmarked job by id and show them all (no
    // server-side paging/filtering). Jobs that were since removed from their
    // source simply 404 and are dropped from the list.
    if (savedMode) {
      if (savedIds.length === 0) {
        setJobs([])
        setTotal(0)
        setLoading(false)
        return
      }
      let cancelled = false
      Promise.all(
        savedIds.map((id) =>
          apiFetch(`/jobs/${id}`)
            .then((res) => (res.ok ? (res.json() as Promise<Job & { _id: string }>) : null))
            .catch(() => null)
        )
      )
        .then((results) => {
          if (cancelled) return
          const found = results.filter((job): job is Job & { _id: string } => job !== null)
          setJobs(found)
          setTotal(found.length)
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
      return () => {
        cancelled = true
      }
    }

    // "My jobs" is a purely client-side view of the user's own added jobs
    // (fetched separately into `myJobs`), so there's no discovery feed to load.
    if (category === 'mine') {
      setJobs([])
      setTotal(0)
      setLoading(false)
      return
    }

    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) })
    if (sortByMatch) params.set('sort', 'match')
    if (category !== 'all') params.set('category', category)
    if (sourceSelection.kind === 'source') params.set('sourceId', sourceSelection.id)
    if (sourceSelection.kind === 'company') params.set('company', sourceSelection.name)
    const discoveredAfter = dateFilterCutoffIso(datePosted)
    if (discoveredAfter) params.set('discoveredAfter', discoveredAfter)
    if (selectedLanguages.length > 0) params.set('languages', languagesKey)
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
  }, [savedMode, savedKey, category, sourceSelectionKey, datePosted, languagesKey, debouncedKeyword, debouncedLocation, debouncedSalaryMin, debouncedSalaryMax, offset, sortByMatch])

  const rangeStart = total === 0 ? 0 : offset + 1
  const rangeEnd = Math.min(offset + PAGE_SIZE, total)

  const filterControls = (
    <div className="filter-rail">
      <div className="group relative mt-4">
        <Icon
          name="search-outline"
          style={{ fontSize: 16 }}
          className="pointer-events-none absolute left-3.5 top-[21px] -translate-y-1/2 text-muted-foreground transition-colors duration-200 group-focus-within:text-indigo-500"
        />
        <input
          ref={searchInputRef}
          type="text"
          placeholder="Search title, company, skills…"
          className="w-full rounded-full border border-input bg-background py-2.5 pl-10 pr-16 text-sm text-foreground shadow-sm outline-none transition-all duration-200 placeholder:text-muted-foreground focus:border-indigo-500 focus:shadow-[0_0_0_4px_rgba(99,102,241,0.15)]"
          value={keyword}
          onChange={(e) => {
            setKeyword(e.target.value)
            setShowSuggestions(true)
          }}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => window.setTimeout(() => setShowSuggestions(false), 120)}
          onKeyDown={onSearchKeyDown}
          role="combobox"
          aria-expanded={showSuggestions && suggestions.length > 0}
          aria-controls="search-suggestions"
          aria-autocomplete="list"
        />
        {/* Right-side affordance: spinner while the term settles, a clear button
            when there's text, otherwise a subtle "/" shortcut hint. */}
        <div className="absolute right-2 top-[21px] -translate-y-1/2">
          {searchPending ? (
            <span
              aria-hidden="true"
              className="block size-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-indigo-500"
            />
          ) : keyword ? (
            <button
              type="button"
              onClick={clearSearch}
              aria-label="Clear search"
              className="flex size-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Icon name="close-outline" style={{ fontSize: 15 }} />
            </button>
          ) : (
            <kbd className="pointer-events-none hidden rounded border border-input px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground lg:inline-block">
              /
            </kbd>
          )}
        </div>

        {showSuggestions && suggestions.length > 0 && (
          <ul
            id="search-suggestions"
            role="listbox"
            className="absolute left-0 right-0 top-full z-30 mt-2 origin-top animate-in fade-in slide-in-from-top-1 overflow-hidden rounded-xl border border-input bg-popover p-1 shadow-lg duration-150"
          >
            {suggestions.map((suggestion, index) => (
              <li key={suggestion._id} role="option" aria-selected={index === activeSuggestion}>
                <button
                  type="button"
                  // Prevent the input's blur from firing before the click lands.
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActiveSuggestion(index)}
                  onClick={() => commitSuggestion(suggestion)}
                  className={`flex w-full flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-left transition-colors ${
                    index === activeSuggestion ? 'bg-muted' : 'hover:bg-muted/60'
                  }`}
                >
                  <span className="line-clamp-1 text-sm font-medium text-foreground">{suggestion.title}</span>
                  <span className="line-clamp-1 text-xs text-muted-foreground">
                    {suggestion.company}
                    {suggestion.location ? ` · ${suggestion.location}` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Accordion defaultValue={['date', 'language', 'source']}>
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

            <AccordionItem value="language">
              <AccordionTrigger>Language</AccordionTrigger>
              <AccordionContent>
                <ul className="flex flex-col gap-2">
                  {LANGUAGE_OPTIONS.map((option) => (
                    <li key={option.value}>
                      <label className="check">
                        <Checkbox
                          checked={selectedLanguages.includes(option.value)}
                          onCheckedChange={(checked) => toggleLanguage(option.value, checked === true)}
                        />
                        {option.label}
                      </label>
                    </li>
                  ))}
                </ul>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="source">
              <AccordionTrigger>Source</AccordionTrigger>
              <AccordionContent>
                <ul className="flex flex-col gap-2">
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
                  {trackedCompanies
                    .filter((trackedCompany) => !SOURCE_LABEL_SET.has(trackedCompany.name))
                    .map((trackedCompany) => (
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
                        <Icon name="checkmark-circle-outline" style={{ fontSize: 14 }} className="shrink-0 text-green-600" aria-label="Verified" />
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

  const [toastMessage, setToastMessage] = useState<string | null>(null)

  // Jobs the user added themselves. Saved mode narrows to bookmarked ones; the
  // language filter applies here too so it behaves like the discovery feed.
  const visibleMyJobs = (savedMode
    ? myJobs.filter((job) => job._id && savedIds.includes(job._id))
    : myJobs
  )
    .filter((job) => userJobMatchesLanguages(job, selectedLanguages))
    .filter((job) => userJobMatchesKeyword(job, debouncedKeyword))

  // Added jobs appear as ordinary rows in the list — on the "My jobs" tab, on the
  // first page of "All jobs", and in saved mode — but never under Government /
  // Other jobs, which are discovery-only categories. In "Best match" mode the list
  // is a pure relevance ranking that added jobs (which have no score) can't join,
  // so they're left out there.
  const myJobRows = savedMode
    ? visibleMyJobs
    : !sortByMatch && (category === 'mine' || (category === 'all' && offset === 0))
      ? visibleMyJobs
      : []

  // Merge added jobs into the discovery feed inline, newest-first, instead of
  // pinning them above it. Each row keeps its own renderer (added jobs link to
  // /my-jobs and show an "Added by you" pill). We only re-sort by date when there
  // are added jobs to interleave AND we're not in "Best match" mode — otherwise
  // the feed's server-side ordering (relevance, or newest-first) is preserved.
  const rowTimestamp = (value?: string | null) => (value ? new Date(value).getTime() : 0)
  type MergedRow =
    | { kind: 'mine'; job: UserJob; ts: number }
    | { kind: 'feed'; job: FeedJob; ts: number }
  const mineAsRows = (): MergedRow[] =>
    myJobRows
      .map((job): MergedRow => ({ kind: 'mine', job, ts: rowTimestamp(job.createdAt) }))
      .sort((a, b) => b.ts - a.ts)
  const mergedRows: MergedRow[] =
    // The "My jobs" tab is strictly the user's own added jobs — never the
    // discovery feed — so we ignore `jobs` here entirely (it also avoids a
    // stale-feed flash while the fetch effect clears it on the tab switch).
    category === 'mine'
      ? mineAsRows()
      : myJobRows.length > 0
        ? [
            ...jobs.map((job): MergedRow => ({ kind: 'feed', job, ts: rowTimestamp(job.discoveredAt) })),
            ...mineAsRows(),
          ].sort((a, b) => b.ts - a.ts)
        : jobs.map((job): MergedRow => ({ kind: 'feed', job, ts: rowTimestamp(job.discoveredAt) }))

  const jobsCountLabel = loading
    ? 'Searching…'
    : savedMode
      ? `${total.toLocaleString()} saved ${total === 1 ? 'job' : 'jobs'}`
      : category === 'mine'
        ? `${myJobRows.length.toLocaleString()} ${myJobRows.length === 1 ? 'job' : 'jobs'}`
        : `${total.toLocaleString()} jobs found`

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
            {isAuthenticated && (
              <button
                type="button"
                role="tab"
                className={`seg${category === 'mine' ? ' on' : ''}`}
                aria-selected={category === 'mine'}
                onClick={() => updateFilters({ category: 'mine' })}
              >
                My jobs
              </button>
            )}
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
          <aside className="hidden w-full shrink-0 lg:sticky lg:top-24 lg:block lg:w-72 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:overscroll-contain lg:pr-2">
            <div className="flex items-center justify-between">
              <span className="count">
                <b>{jobsCountLabel}</b>
              </span>
              <button type="button" onClick={clearFilters} disabled={!hasActiveFilters} className="clear-all">
                <Icon name="close-outline" style={{ fontSize: 14, display: 'inline-block', verticalAlign: 'middle', marginRight: 4 }} />
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
                  <Icon name="options-outline" style={{ fontSize: 14 }} />
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

          <div className="results lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:overscroll-contain lg:pr-1">
            {canSortByMatch && (
              <div className="segment" role="tablist" aria-label="Sort jobs" style={{ marginBottom: 16 }}>
                <button
                  type="button"
                  role="tab"
                  className={`seg${!sortByMatch ? ' on' : ''}`}
                  aria-selected={!sortByMatch}
                  onClick={() => updateFilters({ sort: null })}
                >
                  Newest
                </button>
                <button
                  type="button"
                  role="tab"
                  className={`seg${sortByMatch ? ' on' : ''}`}
                  aria-selected={sortByMatch}
                  onClick={() => updateFilters({ sort: 'match' })}
                >
                  <Icon name="sparkles-outline" style={{ fontSize: 13, marginRight: 4, verticalAlign: 'middle' }} />
                  Best match
                </button>
              </div>
            )}
            {savedMode && (
              <div className="saved-banner">
                <span>
                  <Icon name="briefcase-outline" style={{ fontSize: 15 }} />
                  Showing your saved jobs
                </span>
                <Link to="/jobs" className="btn btn-ghost btn-sm">
                  View all jobs
                </Link>
              </div>
            )}
            {category === 'mine' && (
              <div className="my-jobs-head">
                <h2>Your added jobs</h2>
                <Link to="/add-job" className="btn btn-ghost">
                  <Icon name="add-outline" style={{ fontSize: 14 }} />
                  Add a job
                </Link>
              </div>
            )}

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
            ) : mergedRows.length === 0 ? (
              <p className="saved-empty">
                {savedMode ? (
                  <>
                    <b>No saved jobs yet.</b>
                    Tap the bookmark on any job to save it here.
                  </>
                ) : category === 'mine' ? (
                  selectedLanguages.length > 0 ? (
                    <>
                      <b>No added jobs match these languages.</b>
                      Clear the language filter or add a job.
                    </>
                  ) : (
                    <>
                      <b>You haven't added any jobs yet.</b>
                      Use “Add a job” to track roles you found elsewhere.
                    </>
                  )
                ) : (
                  <>
                    <b>No jobs found.</b>
                    Try widening your filters.
                  </>
                )}
              </p>
            ) : (
              mergedRows.map((row) => {
                if (row.kind === 'mine') {
                  const job = row.job
                  return (
                    <article key={`myjob-${job._id}`} className="jrow">
                      <div className="main">
                        <div className="title">
                          <Link to={`/my-jobs/${job._id}`}>{job.title}</Link>
                        </div>
                        <div className="sub">
                          <Icon name="business-outline" style={{ fontSize: 12, display: 'inline-block', verticalAlign: 'middle', marginRight: 4 }} />
                          {job.company}
                          {job.location ? ` · ${job.location}` : ''}
                        </div>
                        <div className="tags">
                          <Pill tone={job.visibility === 'public' ? 'verified' : 'mono'}>
                            {job.visibility === 'public' ? 'Public' : 'Private'}
                          </Pill>
                          <Pill tone="mono">{formatSalary(job)}</Pill>
                          <Pill tone="mono">Added by you</Pill>
                        </div>
                        {job.description && (
                          <p style={{ marginTop: 10, fontSize: 13.5, color: 'var(--fg-2)', lineHeight: 1.6 }}>
                            {descriptionPreview(job.description)}
                          </p>
                        )}
                        <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <Link to={`/my-jobs/${job._id}`} className="btn btn-ghost">
                            View details
                          </Link>
                          {job.url && (
                            <a href={job.url} target="_blank" rel="noreferrer" className="btn btn-indigo">
                              Apply
                            </a>
                          )}
                        </div>
                      </div>
                      <div className="side">
                        <button
                          type="button"
                          className={`save-btn${job._id && isSaved(job._id) ? ' saved' : ''}`}
                          aria-pressed={!!job._id && isSaved(job._id)}
                          aria-label={job._id && isSaved(job._id) ? 'Remove from saved' : 'Save job'}
                          onClick={() => job._id && handleToggleSaved(job._id)}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
                            <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" />
                          </svg>
                        </button>
                      </div>
                    </article>
                  )
                }
                const job = row.job
                const requirements = requirementsPreview(job.rawDescription)
                return (
                  <article key={job._id} className="jrow">
                    <ScoreRing score={job.matchScore ?? job.score ?? 0} />
                    <div className="main">
                      <div className="title">
                        <Link to={`/jobs/${job._id}`}>{job.title}</Link>
                      </div>
                      <div className="sub">
                        <Icon name="business-outline" style={{ fontSize: 12, display: 'inline-block', verticalAlign: 'middle', marginRight: 4 }} />
                        {job.company}
                        {job.location ? ` · ${job.location}` : ''}
                      </div>
                      <div className="tags">
                        {typeof job.matchScore === 'number' && (
                          <Pill tone="verified">{Math.round(job.matchScore)}% match</Pill>
                        )}
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

            {!savedMode && category !== 'mine' && (
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
            )}
          </div>
        </div>
      </section>
      <Footer />
      <div className={`toast${toastMessage ? ' show' : ''}`}>{toastMessage}</div>
    </div>
  )
}
