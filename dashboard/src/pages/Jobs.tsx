import { Icon } from '../components/Icon'
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import type { Job, JobSourceId, UserJob } from '@job-hunter/shared'
import { apiFetch } from '../api/client'
import { gsap } from '../lib/gsap'
import { useAuth } from '../auth/AuthContext'
import { PublicNav } from '../components/Nav'
import { Footer } from '../components/Footer'
import { Button } from '../components/Button'
import { FormError } from '../components/FormError'
import { useSavedJobs } from '../hooks/useSavedJobs'
import { relativeTimeFromNow } from '../lib/relativeTime'
import { sourceLogoUrl } from '../lib/sourceLogo'
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

// Marks a feed row as a live internet result (its id is synthetic, e.g.
// "internet:remoteok:123") rather than a stored discovery job. Such rows have no
// detail page and can't be bookmarked, so they apply externally instead.
function isInternetJob(job: { _id: string }): boolean {
  return job._id.startsWith('internet:')
}

// Internet-mode results are already resume-matched and ranked server-side, so the
// only client-side narrowing is the search box and language filter (the rest of
// the rail is feed-only and hidden in that mode). These mirror the user-job
// matchers above but read a discovery Job's fields (rawDescription, not description).
function feedJobMatchesKeyword(job: FeedJob, keyword: string): boolean {
  const needle = keyword.trim().toLowerCase()
  if (!needle) return true
  const haystack = `${job.title}\n${job.company}\n${job.rawDescription}\n${job.location ?? ''}`
  return haystack.toLowerCase().includes(needle)
}

function feedJobMatchesLanguages(job: FeedJob, languages: string[]): boolean {
  if (languages.length === 0) return true
  const pattern = languages.map((key) => LANGUAGE_MATCHERS[key]).filter(Boolean).join('|')
  if (!pattern) return true
  return new RegExp(pattern, 'i').test(`${job.title}\n${job.rawDescription}`)
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

// matchScore is present only on responses from the "Best match" sort (sort=match) and the
// "Find jobs from the internet" feed; it's the 0–100 relevance of the job to the signed-in
// user's resume. `source` is the human-facing origin (board name or hostname) sent for
// internet results, whose synthetic sourceId isn't a known JobSourceId.
type FeedJob = Job & { _id: string; matchScore?: number; source?: string }

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

function formatSalary(salary: { salaryMin: number | null; salaryMax: number | null }): string {
  const { salaryMin, salaryMax } = salary
  if (salaryMin == null && salaryMax == null) return '—'
  if (salaryMin != null && salaryMax != null) {
    return `$${salaryMin.toLocaleString()} – $${salaryMax.toLocaleString()}`
  }
  return `$${(salaryMin ?? salaryMax)?.toLocaleString()}`
}

// Salary for the card footer — "Negotiable" when the posting has no salary.
function salaryLabel(salary: { salaryMin: number | null; salaryMax: number | null }): string {
  const formatted = formatSalary(salary)
  return formatted === '—' ? 'Negotiable' : formatted
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

type SlidingTab = { key: string; label: ReactNode; selected: boolean; onSelect: () => void }

// Segmented control matching the landing page: a neutral glass pill slides behind
// the active tab (same sliding-window motion as the global nav and landing filters).
function SlidingTabs({ tabs, ariaLabel }: { tabs: SlidingTab[]; ariaLabel: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [indicator, setIndicator] = useState<{ left: number; width: number; ready: boolean }>({
    left: 0,
    width: 0,
    ready: false,
  })
  const activeKey = tabs.find((tab) => tab.selected)?.key

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    function reposition() {
      const current = el!.querySelector<HTMLElement>('button.on')
      if (!current) {
        setIndicator((prev) => ({ ...prev, ready: false }))
        return
      }
      setIndicator({ left: current.offsetLeft, width: current.offsetWidth, ready: true })
    }
    reposition()
    const observer = new ResizeObserver(reposition)
    observer.observe(el)
    return () => observer.disconnect()
  }, [activeKey, tabs.length])

  return (
    <div className="lp-filters" role="tablist" aria-label={ariaLabel} ref={ref}>
      <span
        className="lp-filters-indicator"
        aria-hidden="true"
        style={{
          transform: `translateX(${indicator.left}px)`,
          width: indicator.width,
          opacity: indicator.ready ? 1 : 0,
        }}
      />
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={tab.selected}
          className={`lp-chip ${tab.selected ? 'on' : ''}`}
          onClick={tab.onSelect}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

type ViewMode = 'grid' | 'list'

// Company monogram shown in the card's logo circle (we don't store real logos).
function companyInitials(name?: string | null): string {
  const trimmed = (name ?? '').trim()
  if (!trimmed) return '—'
  const letters = trimmed
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
  return letters.toUpperCase() || '—'
}

// Skills shown as tags on a card. Prefers the job's extracted required skills;
// when none are stored (most current jobs), it detects known languages/skills
// from the job text using the same patterns the language filter uses.
function detectSkills(text: string): string[] {
  return LANGUAGE_OPTIONS.filter((option) => {
    const pattern = LANGUAGE_MATCHERS[option.value]
    return pattern ? new RegExp(pattern, 'i').test(text) : false
  }).map((option) => option.label)
}

function skillTags(extracted: string[] | null | undefined, text: string): string[] {
  const fromExtracted = (extracted ?? []).filter(Boolean)
  if (fromExtracted.length) return fromExtracted.slice(0, 8)
  return detectSkills(text).slice(0, 8)
}

// Aggregator / job-board hosts whose favicon is NOT the company's logo — for feed
// jobs the stored URL points here, so we skip them and fall back to the monogram.
const AGGREGATOR_HOSTS = new Set([
  'himalayas.app',
  'remoteok.com',
  'remoteok.io',
  'weworkremotely.com',
  'adzuna.com',
  'ats.hirebee.ai',
  'hirebee.ai',
  'boards.greenhouse.io',
  'jobs.lever.co',
  'apply.workable.com',
  'teletalk.com.bd',
  'alljobs.teletalk.com.bd',
])

function hostFromUrl(url?: string | null): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

// A crisp favicon for a domain via Google's favicon service — used as the company
// logo when we can resolve a real domain. Falls back (via <img onError>) to the
// monogram when it fails to load.
function faviconUrl(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`
}

// Grid/list layout switch at the top-right of the results column.
function ViewToggle({ value, onChange }: { value: ViewMode; onChange: (next: ViewMode) => void }) {
  return (
    <div className="view-toggle" role="group" aria-label="Results layout">
      <button
        type="button"
        className={value === 'grid' ? 'on' : ''}
        aria-pressed={value === 'grid'}
        aria-label="Grid view"
        onClick={() => onChange('grid')}
      >
        <Icon name="grid-outline" style={{ fontSize: 16 }} />
      </button>
      <button
        type="button"
        className={value === 'list' ? 'on' : ''}
        aria-pressed={value === 'list'}
        aria-label="List view"
        onClick={() => onChange('list')}
      >
        <Icon name="list-outline" style={{ fontSize: 16 }} />
      </button>
    </div>
  )
}

// Animated custom dropdown replacing a native <select> in the filter bar: the
// chevron rotates, the menu fades/slides in, options highlight on hover and the
// active one shows a check. Closes on outside-click, Escape, or selection.
function AnimatedSelect({
  value,
  options,
  onChange,
  icon,
  ariaLabel,
}: {
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (next: string) => void
  icon?: string
  ariaLabel: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    function onDoc(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  const selected = options.find((option) => option.value === value) ?? options[0]
  return (
    <div className={`jv-select${open ? ' open' : ''}`} ref={ref}>
      <button
        type="button"
        className="jv-select__btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((prev) => !prev)}
      >
        {icon && <Icon name={icon} className="jv-field__icon" style={{ fontSize: 15 }} />}
        <span className="jv-select__value">{selected?.label}</span>
        <Icon name="chevron-down-outline" className="jv-select__chevron" style={{ fontSize: 15 }} />
      </button>
      {open && (
        <ul className="jv-select__menu" role="listbox" aria-label={ariaLabel}>
          {options.map((option, i) => (
            <li key={option.value} role="option" aria-selected={option.value === value} style={{ '--oi': i } as CSSProperties}>
              <button
                type="button"
                className={`jv-select__opt${option.value === value ? ' on' : ''}`}
                onClick={() => {
                  onChange(option.value)
                  setOpen(false)
                }}
              >
                <span>{option.label}</span>
                {option.value === value && <Icon name="checkmark-outline" style={{ fontSize: 14 }} />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// Dual-thumb salary range slider (two overlaid native range inputs). Writes
// through to the existing salaryMin/salaryMax filter state.
const SALARY_FLOOR = 0
const SALARY_CEIL = 300000
const SALARY_STEP = 5000
function formatK(value: number): string {
  return `$${Math.round(value / 1000)}K`
}
function SalaryRange({
  min,
  max,
  onChange,
}: {
  min: string
  max: string
  onChange: (next: { min?: string; max?: string }) => void
}) {
  const lo = min.trim() === '' ? SALARY_FLOOR : Math.max(SALARY_FLOOR, Number(min) || SALARY_FLOOR)
  const hi = max.trim() === '' ? SALARY_CEIL : Math.min(SALARY_CEIL, Number(max) || SALARY_CEIL)
  const leftPct = ((lo - SALARY_FLOOR) / (SALARY_CEIL - SALARY_FLOOR)) * 100
  const rightPct = ((hi - SALARY_FLOOR) / (SALARY_CEIL - SALARY_FLOOR)) * 100
  return (
    <div className="jv-slider">
      <div className="jv-slider__track">
        <span className="jv-slider__fill" style={{ left: `${leftPct}%`, right: `${100 - rightPct}%` }} />
        <input
          type="range"
          aria-label="Minimum salary"
          min={SALARY_FLOOR}
          max={SALARY_CEIL}
          step={SALARY_STEP}
          value={lo}
          onChange={(e) => {
            const next = Math.min(Number(e.target.value), hi - SALARY_STEP)
            onChange({ min: next <= SALARY_FLOOR ? '' : String(next) })
          }}
        />
        <input
          type="range"
          aria-label="Maximum salary"
          min={SALARY_FLOOR}
          max={SALARY_CEIL}
          step={SALARY_STEP}
          value={hi}
          onChange={(e) => {
            const next = Math.max(Number(e.target.value), lo + SALARY_STEP)
            onChange({ max: next >= SALARY_CEIL ? '' : String(next) })
          }}
        />
      </div>
      <div className="jv-slider__labels">
        <span>{formatK(lo)}</span>
        <span>{hi >= SALARY_CEIL ? `${formatK(SALARY_CEIL)}+` : formatK(hi)}</span>
      </div>
    </div>
  )
}

// A single job rendered as the reference's white card. Kind-specific bits are
// composed by the caller and passed in, so one card renders added, community and
// feed jobs alike.
function JobCard({
  index,
  logoLabel,
  logoUrl,
  dateLabel,
  company,
  verified,
  titleNode,
  tags,
  stat,
  saveControl,
  detailsNode,
}: {
  index: number
  logoLabel: string
  logoUrl?: string | null
  dateLabel: string | null
  company?: ReactNode
  verified?: boolean
  titleNode: ReactNode
  tags: string[]
  stat: ReactNode
  saveControl: ReactNode
  detailsNode: ReactNode
}) {
  return (
    <article className="tcard row-in" style={{ '--i': index } as CSSProperties}>
      <div className="tcard__top">
        <div className="tcard__ident">
          <span className="tcard__logo" aria-hidden="true">
            <span className="tcard__logo-mono">{logoLabel}</span>
            {logoUrl && (
              <img
                className="tcard__logo-img"
                src={logoUrl}
                alt=""
                loading="lazy"
                onError={(e) => e.currentTarget.remove()}
              />
            )}
          </span>
          {dateLabel && <span className="tcard__date">{dateLabel}</span>}
        </div>
        {saveControl && <div className="tcard__save">{saveControl}</div>}
      </div>
      {company && (
        <div className="tcard__company">
          <span className="tcard__co-name">{company}</span>
          {verified && (
            <Icon name="checkmark-circle" className="tcard__verified" style={{ fontSize: 15 }} aria-label="Verified" />
          )}
        </div>
      )}
      <h3 className="tcard__title">{titleNode}</h3>
      {tags.length > 0 && (
        <div className="tcard__tags">
          {tags.map((tag, i) => (
            <span key={i} className="tcard__tag">
              {tag}
            </span>
          ))}
        </div>
      )}
      <div className="tcard__foot">
        <div className="tcard__stats">{stat}</div>
        <div className="tcard__cta">{detailsNode}</div>
      </div>
    </article>
  )
}

export function JobsPage() {
  const { isAuthenticated, email } = useAuth()
  const navigate = useNavigate()
  const headerRef = useRef<HTMLElement | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const [jobs, setJobs] = useState<FeedJob[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [trackedCompanies, setTrackedCompanies] = useState<TrackedCompany[]>([])
  const [myJobs, setMyJobs] = useState<UserJob[]>([])
  // Public jobs other members added and shared — surfaced in the shared feed.
  const [communityJobs, setCommunityJobs] = useState<UserJob[]>([])
  // Whether the signed-in user has a resume to match against — gates the "Best match" sort.
  const [hasResume, setHasResume] = useState(false)
  // Display name for the "Welcome back" greeting, read from the resume.
  const [userName, setUserName] = useState<string | null>(null)

  const { isSaved, toggleSaved, savedIds } = useSavedJobs()
  // "Saved jobs" mode (reached via /jobs?saved=1 from the sidebar) shows only
  // the jobs the user bookmarked. Saved ids live in localStorage, so this view
  // fetches them by id rather than going through the server-side filters.
  const savedMode = searchParams.get('saved') === '1'
  const savedKey = savedIds.join(',')
  // Only the saved view cares when the saved set changes; in the normal feed,
  // toggling a bookmark must NOT refetch (otherwise the whole list flashes/reloads
  // on every save). Scoping the dep to saved mode keeps saving instant + local.
  const savedFetchKey = savedMode ? savedKey : ''

  // "Find jobs from the internet" mode (reached via /jobs?internet=1). Instead of
  // the stored discovery feed, this fetches postings live from the internet-wide
  // job boards and ranks them against the signed-in user's resume. Results are
  // ephemeral — not persisted — so there's no paging or server-side filtering.
  const internetMode = searchParams.get('internet') === '1'

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

  // Results layout: a 3-up pastel card grid (default) or the full-width list.
  // Persisted in the URL so it survives reloads and shared links; changing it
  // must not reset paging.
  const viewMode: ViewMode = searchParams.get('view') === 'list' ? 'list' : 'grid'
  function setViewMode(next: ViewMode) {
    updateFilters({ view: next === 'grid' ? null : 'list' }, { resetOffset: false })
  }

  // "Best match" semantic sort is only meaningful for a signed-in user with a resume, and not
  // in the saved / "my jobs" views (which aren't the discovery feed). Government jobs are
  // unscored and never embedded, so the vector-ranked path excludes them — match-sort would
  // return an empty Government tab, so disable it there too. The server falls back to
  // newest-first if it can't match, but we only surface the control when it will actually work.
  const canSortByMatch =
    isAuthenticated && hasResume && !savedMode && !internetMode && category !== 'mine' && category !== 'government'
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

  // Staggered header entrance — kicker, headline, lead and category tabs rise into
  // place with a soft focus-in, mirroring the landing hero's `.hero-reveal` motion.
  useEffect(() => {
    const container = headerRef.current
    if (!container || prefersReducedMotion()) return
    const ctx = gsap.context(() => {
      gsap.from('.hero-reveal', {
        opacity: 0,
        y: 24,
        filter: 'blur(8px)',
        duration: 0.7,
        stagger: 0.09,
        ease: 'power3.out',
        delay: 0.05,
        clearProps: 'filter',
      })
    }, container)
    return () => ctx.revert()
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
    Number(internetMode) +
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

  function toggleInternetMode() {
    // Needs the signed-in user's resume to match against; send guests to sign in.
    if (!isAuthenticated) {
      navigate('/login')
      return
    }
    if (internetMode) {
      updateFilters({ internet: null })
      return
    }
    // Entering internet mode replaces the stored feed, so drop the feed-only
    // filters (category/source/date/salary/sort) that don't apply to live results.
    const next = new URLSearchParams(searchParams)
    next.set('internet', '1')
    for (const key of ['category', 'sourceId', 'company', 'datePosted', 'salaryMin', 'salaryMax', 'sort', 'saved', 'offset']) {
      next.delete(key)
    }
    setSearchParams(next, { replace: true })
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
  // The signed-in user's own added jobs (`myJobs`) only ever render as `myJobRows`:
  // in saved mode, on the "My jobs" tab, or on the first page of "All jobs" (never
  // under Government/Other, in internet/best-match mode, or on paginated pages).
  // Fetch /user-jobs only when that view will actually show them — otherwise the
  // request is wasted work on load. Mirrors the `myJobRows` condition below.
  const needMyJobs =
    isAuthenticated &&
    (savedMode || category === 'mine' || (category === 'all' && offset === 0 && !internetMode && !sortByMatch))

  // Community (other members' shared) jobs only render on the first page of
  // "All jobs". Fetch /jobs/community only for that view. Mirrors `communityJobRows`.
  const needCommunity =
    !savedMode && !internetMode && !sortByMatch && category === 'all' && offset === 0

  useEffect(() => {
    if (!needMyJobs) {
      setMyJobs([])
      return
    }
    apiFetch('/user-jobs')
      .then((res) => (res.ok ? res.json() : { jobs: [] }))
      .then((body: { jobs: UserJob[] }) => setMyJobs(body.jobs))
      .catch(() => setMyJobs([]))
  }, [needMyJobs])

  // Resume status drives always-visible header UI (the greeting, the "Resume on
  // file"/upload banner, and whether the "Best match" sort is offered), so it's
  // fetched for every signed-in load — but never for logged-out visitors.
  useEffect(() => {
    if (!isAuthenticated) {
      setHasResume(false)
      setUserName(null)
      return
    }
    // A resume (uploaded CV text or a non-empty structured resume) is what the "Best match"
    // sort ranks against. resumeEmbedding itself is projected out of the profile response, so
    // we infer eligibility from the resume content the server does return.
    apiFetch('/profile')
      .then((res) => (res.ok ? res.json() : null))
      .then((profile: { cvText?: string | null; resume?: { fullName?: string | null; skillGroups?: unknown[] } } | null) => {
        const hasCv = Boolean(profile?.cvText && profile.cvText.trim())
        const hasSkills = Boolean(profile?.resume?.skillGroups && profile.resume.skillGroups.length > 0)
        setHasResume(hasCv || hasSkills)
        setUserName(profile?.resume?.fullName?.trim() || null)
      })
      .catch(() => setHasResume(false))
  }, [isAuthenticated])

  // Public jobs other members added and chose to share. The API excludes the
  // signed-in user's own (those already appear under "My jobs"). Fetched only for
  // the first page of "All jobs" — the only view that renders them.
  useEffect(() => {
    if (!needCommunity) {
      setCommunityJobs([])
      return
    }
    apiFetch('/jobs/community')
      .then((res) => (res.ok ? res.json() : { jobs: [] }))
      .then((body: { jobs: UserJob[] }) => setCommunityJobs(body.jobs))
      .catch(() => setCommunityJobs([]))
  }, [needCommunity])

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

    // Internet mode: fetch resume-matched postings live from the job boards. The
    // server ranks them against the user's resume and returns them in one shot, so
    // there's no server-side filtering or paging here.
    if (internetMode) {
      let cancelled = false
      apiFetch('/jobs/from-internet')
        .then(async (res) => {
          if (cancelled) return
          if (res.status === 401) {
            setError('Sign in to find jobs matched to your resume.')
            setJobs([])
            setTotal(0)
            return
          }
          if (res.status === 422) {
            setError('Upload your resume first — we match internet jobs against it.')
            setJobs([])
            setTotal(0)
            return
          }
          if (!res.ok) {
            setError('Could not fetch jobs from the internet. Please try again.')
            setJobs([])
            setTotal(0)
            return
          }
          const data: JobsResponseBody = await res.json()
          setJobs(data.jobs)
          setTotal(data.total)
        })
        .catch(() => {
          if (cancelled) return
          setError('Could not fetch jobs from the internet. Please try again.')
          setJobs([])
          setTotal(0)
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
      return () => {
        cancelled = true
      }
    }

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
  }, [internetMode, savedMode, savedFetchKey, category, sourceSelectionKey, datePosted, languagesKey, debouncedKeyword, debouncedLocation, debouncedSalaryMin, debouncedSalaryMax, offset, sortByMatch])

  const rangeStart = total === 0 ? 0 : offset + 1
  const rangeEnd = Math.min(offset + PAGE_SIZE, total)

  // The keyword search field (with typeahead) — rendered in the top search bar.
  const keywordField = (
    <div className="jv-field jv-field--search group">
      <label className="jv-field__label" htmlFor="jobs-keyword">
        Job Title / Keywords
      </label>
      <div className="jv-field__control">
        <Icon name="search-outline" className="jv-field__icon" style={{ fontSize: 15 }} />
        <input
          id="jobs-keyword"
          ref={searchInputRef}
          type="text"
          placeholder="e.g. UI Designer, Backend Developer"
          className="jv-field__input"
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
        {searchPending ? (
          <span
            aria-hidden="true"
            className="block size-4 shrink-0 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-indigo-500"
          />
        ) : keyword ? (
          <button
            type="button"
            onClick={clearSearch}
            aria-label="Clear search"
            className="flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Icon name="close-outline" style={{ fontSize: 15 }} />
          </button>
        ) : null}
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
  )

  const filterControls = (
    <div className="filter-rail">
      <button
        type="button"
        onClick={toggleInternetMode}
        aria-pressed={internetMode}
        className={`flex w-full items-center justify-center gap-2 rounded-full border px-4 py-2.5 text-sm font-medium shadow-sm transition-all duration-200 hover:-translate-y-px active:translate-y-0 ${
          internetMode
            ? 'border-indigo-500 bg-indigo-500 text-white hover:bg-indigo-600'
            : 'border-input bg-background text-foreground hover:border-indigo-400 hover:text-indigo-600'
        }`}
      >
        <Icon name="globe-outline" style={{ fontSize: 16 }} />
        {internetMode ? 'Browsing the internet' : 'Find jobs from the internet'}
      </button>
      {internetMode && (
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          Showing live roles from across the web, ranked against your resume. Use search and the
          language filter to narrow them.
        </p>
      )}

      <Accordion defaultValue={['date', 'language', 'source', 'salary']}>
            {!internetMode && (
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
            )}

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

            {!internetMode && (
            <>
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
              <AccordionTrigger>Salary Range</AccordionTrigger>
              <AccordionContent>
                <SalaryRange
                  min={salaryMin}
                  max={salaryMax}
                  onChange={({ min, max }) => {
                    if (min !== undefined) setSalaryMin(min)
                    if (max !== undefined) setSalaryMax(max)
                  }}
                />
              </AccordionContent>
            </AccordionItem>
            </>
            )}
          </Accordion>
    </div>
  )

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
    : !internetMode && !sortByMatch && (category === 'mine' || (category === 'all' && offset === 0))
      ? visibleMyJobs
      : []

  // Public jobs shared by other members. They live in another user's space, so
  // they aren't bookmarkable and never appear in saved mode; otherwise they honor
  // the same language/keyword filters as added jobs. Shown only on the first page
  // of "All jobs" (not under Government/Other, which are discovery-only), and not
  // in "Best match" mode, where the list is a pure score ranking they can't join.
  const visibleCommunityJobs = communityJobs
    .filter((job) => userJobMatchesLanguages(job, selectedLanguages))
    .filter((job) => userJobMatchesKeyword(job, debouncedKeyword))
  const communityJobRows =
    !savedMode && !internetMode && !sortByMatch && category === 'all' && offset === 0 ? visibleCommunityJobs : []

  // Merge added jobs into the discovery feed inline, newest-first, instead of
  // pinning them above it. Each row keeps its own renderer (added jobs link to
  // /my-jobs and show an "Added by you" pill). We only re-sort by date when there
  // are added jobs to interleave AND we're not in "Best match" mode — otherwise
  // the feed's server-side ordering (relevance, or newest-first) is preserved.
  const rowTimestamp = (value?: string | null) => (value ? new Date(value).getTime() : 0)
  type MergedRow =
    | { kind: 'mine'; job: UserJob; ts: number }
    | { kind: 'community'; job: UserJob; ts: number }
    | { kind: 'feed'; job: FeedJob; ts: number }
  const mineAsRows = (): MergedRow[] =>
    myJobRows.map((job): MergedRow => ({ kind: 'mine', job, ts: rowTimestamp(job.createdAt) }))
  const communityAsRows = (): MergedRow[] =>
    communityJobRows.map((job): MergedRow => ({ kind: 'community', job, ts: rowTimestamp(job.createdAt) }))
  const mergedRows: MergedRow[] =
    // The "My jobs" tab is strictly the user's own added jobs — never the
    // discovery feed or others' shared jobs — so we ignore `jobs` here entirely
    // (it also avoids a stale-feed flash while the fetch effect clears it on the
    // tab switch).
    category === 'mine'
      ? mineAsRows().sort((a, b) => b.ts - a.ts)
      : (() => {
          // Added jobs and shared community jobs are interleaved into the feed
          // newest-first; we only re-sort when there are extras to weave in, so an
          // extras-free feed keeps the server's ordering (relevance / newest-first).
          // In internet mode the feed is the live, resume-ranked results; apply the
          // two client-side filters that still make sense (search + language) and
          // keep the server's relevance order (no extras to interleave).
          const feedJobs = internetMode
            ? jobs.filter(
                (job) =>
                  feedJobMatchesKeyword(job, debouncedKeyword) &&
                  feedJobMatchesLanguages(job, selectedLanguages),
              )
            : jobs
          const feedRows = feedJobs.map(
            (job): MergedRow => ({ kind: 'feed', job, ts: rowTimestamp(job.discoveredAt) }),
          )
          const extras = [...mineAsRows(), ...communityAsRows()]
          return extras.length > 0 ? [...feedRows, ...extras].sort((a, b) => b.ts - a.ts) : feedRows
        })()

  const jobsCountLabel = loading
    ? internetMode
      ? 'Searching the web…'
      : 'Searching…'
    : savedMode
      ? `${total.toLocaleString()} saved ${total === 1 ? 'job' : 'jobs'}`
      : internetMode
        ? `${total.toLocaleString()} ${total === 1 ? 'job' : 'jobs'} from the web`
        : category === 'mine'
          ? `${myJobRows.length.toLocaleString()} ${myJobRows.length === 1 ? 'job' : 'jobs'}`
          : `${total.toLocaleString()} jobs found`

  function handleToggleSaved(jobId: string) {
    const willBeSaved = !isSaved(jobId)
    toggleSaved(jobId)
    toast(willBeSaved ? 'Saved job' : 'Removed from saved')
  }

  const categoryTabs: SlidingTab[] = [
    { key: 'all', label: 'All jobs', selected: category === 'all' && !internetMode, onSelect: () => updateFilters({ category: null, internet: null }) },
    { key: 'government', label: 'Government', selected: category === 'government' && !internetMode, onSelect: () => updateFilters({ category: 'government', internet: null }) },
    ...(isAuthenticated
      ? [{ key: 'mine', label: 'My jobs', selected: category === 'mine' && !internetMode, onSelect: () => updateFilters({ category: 'mine', internet: null }) }]
      : []),
    { key: 'private', label: 'Other jobs', selected: category === 'private' && !internetMode, onSelect: () => updateFilters({ category: 'private', internet: null }) },
  ]

  const sortTabs: SlidingTab[] = [
    { key: 'newest', label: 'Newest', selected: !sortByMatch, onSelect: () => updateFilters({ sort: null }) },
    {
      key: 'match',
      label: (
        <>
          <Icon name="sparkles-outline" style={{ fontSize: 13 }} />
          Best match
        </>
      ),
      selected: sortByMatch,
      onSelect: () => updateFilters({ sort: 'match' }),
    },
  ]

  // A signature of everything that re-shapes the feed. Re-keying the list on it
  // remounts the rows so their staggered entrance replays — the landing grid's
  // "smooth filtering transition" applied to the feed.
  const listKey = `${category}|${internetMode}|${savedMode}|${sortByMatch}|${sourceSelectionKey}|${datePosted}|${languagesKey}|${debouncedKeyword}|${offset}`

  const greetingName = userName || (email ? email.split('@')[0] : null)
  const containerClass = viewMode === 'grid' ? 'jv-grid' : 'jv-list'

  // Map tracked companies (from the seed list) to their website host, so jobs from
  // those companies get a real logo. Keyed by lowercased company name.
  const companyDomainMap = new Map<string, string>()
  for (const tracked of trackedCompanies) {
    const host = hostFromUrl(tracked.website)
    if (host) companyDomainMap.set(tracked.name.toLowerCase().trim(), host)
  }
  // Best-effort company logo domain: a tracked company's website, or the job's own
  // URL host when it isn't a known aggregator/board. Null → show the monogram.
  function logoDomainFor(company?: string | null, jobUrl?: string | null): string | null {
    const name = (company ?? '').toLowerCase().trim()
    const tracked = companyDomainMap.get(name)
    if (tracked) return tracked
    const host = hostFromUrl(jobUrl)
    if (host && !AGGREGATOR_HOSTS.has(host)) return host
    return null
  }
  function logoUrlFor(company?: string | null, jobUrl?: string | null): string | null {
    const domain = logoDomainFor(company, jobUrl)
    return domain ? faviconUrl(domain) : null
  }

  // Renders one merged row as the reference's white card (used for both grid and
  // full-width list layouts — only the container's column count changes).
  function renderCard(row: MergedRow, index: number): ReactNode {
    if (row.kind === 'mine') {
      const job = row.job
      return (
        <JobCard
          key={`myjob-${job._id}`}
          index={index}
          logoLabel={companyInitials(job.company)}
          logoUrl={logoUrlFor(job.company, job.url)}
          dateLabel={relativeTimeFromNow(job.createdAt)}
          company={job.company}
          titleNode={<Link to={`/my-jobs/${job._id}`}>{job.title}</Link>}
          tags={(() => {
            const s = skillTags(job.extractedRequirements?.requiredSkills, `${job.title}\n${job.description}`)
            return s.length ? s : [job.visibility === 'public' ? 'Public' : 'Private', 'Added by you']
          })()}
          stat={
            <span className="tcard__stat tcard__stat--muted">
              <Icon name="wallet-outline" style={{ fontSize: 13 }} />
              {salaryLabel(job)}
            </span>
          }
          saveControl={
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
          }
          detailsNode={
            <Link to={`/my-jobs/${job._id}`} className="btn btn-indigo tcard__details">
              Details
            </Link>
          }
        />
      )
    }
    if (row.kind === 'community') {
      const job = row.job
      return (
        <JobCard
          key={`community-${job._id}`}
          index={index}
          logoLabel={companyInitials(job.company)}
          logoUrl={logoUrlFor(job.company, job.url)}
          dateLabel={relativeTimeFromNow(job.createdAt)}
          company={job.company}
          verified
          titleNode={<Link to={`/community-jobs/${job._id}`}>{job.title}</Link>}
          tags={(() => {
            const s = skillTags(job.extractedRequirements?.requiredSkills, `${job.title}\n${job.description}`)
            return s.length ? s : ['Community', 'Shared by a member']
          })()}
          stat={
            <span className="tcard__stat tcard__stat--muted">
              <Icon name="wallet-outline" style={{ fontSize: 13 }} />
              {salaryLabel(job)}
            </span>
          }
          saveControl={null}
          detailsNode={
            <Link to={`/community-jobs/${job._id}`} className="btn btn-indigo tcard__details">
              Details
            </Link>
          }
        />
      )
    }
    const job = row.job
    const internet = isInternetJob(job)
    // Prefer the job's skills (extracted or detected from its text); fall back to
    // source/location tags when no skills are found (e.g. government circulars).
    const fallbackTags: string[] = []
    if (job.sourceId === 'teletalk-govt') fallbackTags.push('Government')
    if (internet) fallbackTags.push('From the web')
    if (job.location && job.location.length <= 22) fallbackTags.push(job.location)
    fallbackTags.push(SOURCE_LABELS[job.sourceId] ?? job.source ?? 'Job board')
    const skills = skillTags(job.extractedRequirements?.requiredSkills, `${job.title}\n${job.rawDescription}`)
    const tags = skills.length ? skills : fallbackTags.slice(0, 3)
    return (
      <JobCard
        key={job._id}
        index={index}
        logoLabel={companyInitials(job.company ?? job.source)}
        logoUrl={sourceLogoUrl(job.sourceId) ?? logoUrlFor(job.company, internet ? job.normalizedUrl : null)}
        dateLabel={relativeTimeFromNow(internet ? (job.postedAt ?? job.discoveredAt) : job.discoveredAt)}
        company={job.company ?? job.source}
        verified={!internet && job.status === 'verified'}
        titleNode={
          internet ? (
            <a href={job.normalizedUrl} target="_blank" rel="noreferrer">
              {job.title}
            </a>
          ) : (
            <Link to={`/jobs/${job._id}`}>{job.title}</Link>
          )
        }
        tags={tags}
        stat={
          <>
            {typeof job.matchScore === 'number' && (
              <span className="tcard__stat">
                <Icon name="sparkles-outline" style={{ fontSize: 13 }} />
                {Math.round(job.matchScore)}%
              </span>
            )}
            <span className="tcard__stat tcard__stat--muted">
              <Icon name="wallet-outline" style={{ fontSize: 13 }} />
              {salaryLabel(job)}
            </span>
          </>
        }
        saveControl={
          internet ? null : (
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
          )
        }
        detailsNode={
          internet ? (
            <a href={job.normalizedUrl} target="_blank" rel="noreferrer" className="btn btn-indigo tcard__details">
              Details
            </a>
          ) : (
            <Link to={`/jobs/${job._id}`} className="btn btn-indigo tcard__details">
              Details
            </Link>
          )
        }
      />
    )
  }

  const searchBar = (
    <div className="jv-searchbar hero-reveal">
      {keywordField}
      <div className="jv-field">
        <label className="jv-field__label" htmlFor="jobs-location">
          Location
        </label>
        <div className="jv-field__control">
          <Icon name="location-outline" className="jv-field__icon" style={{ fontSize: 15 }} />
          <input
            id="jobs-location"
            type="text"
            placeholder="e.g. Remote, Europe"
            className="jv-field__input"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
        </div>
      </div>
      <div className="jv-field">
        <span className="jv-field__label">Source</span>
        <AnimatedSelect
          ariaLabel="Source"
          value={sourceSelection.kind === 'source' ? sourceSelection.id : ''}
          onChange={(next) => updateFilters({ sourceId: next || null, company: null })}
          options={[{ value: '', label: 'All sources' }, ...SOURCE_OPTIONS]}
        />
      </div>
      <div className="jv-field">
        <span className="jv-field__label">Date posted</span>
        <AnimatedSelect
          ariaLabel="Date posted"
          value={datePosted === 'all' ? '' : datePosted}
          onChange={(next) => updateFilters({ datePosted: next || null })}
          options={[{ value: '', label: 'Any time' }, ...DATE_FILTER_OPTIONS.map((o) => ({ value: o.value, label: o.label }))]}
        />
      </div>
      <button type="button" className="btn btn-indigo jv-searchbar__btn" onClick={() => setShowSuggestions(false)}>
        <Icon name="search-outline" style={{ fontSize: 16 }} />
        Search
      </button>
    </div>
  )

  return (
    <div className="page-enter type-pro apple-ui jobs-v2">
      <PublicNav />
      <div className="jv-shell">
        <main className="jv-main">
          <header ref={headerRef} className="jv-hero">
            <div className="hero-bg" aria-hidden="true" />
            <div className="hero-aurora" aria-hidden="true" />
            <div className="jv-hero__content">
              <div className="kicker hero-reveal">Job feed</div>
              <h1 className="hero-reveal">
                {isAuthenticated ? (
                  <>
                    Welcome back{greetingName ? ', ' : ''}
                    {greetingName && <em>{greetingName}</em>}
                  </>
                ) : (
                  <>
                    Find your <em>next role</em>
                  </>
                )}
              </h1>
              <p className="jv-hero-sub hero-reveal">
                <span>
                  {loading
                    ? 'Finding roles for you…'
                    : `${total.toLocaleString()} ${total === 1 ? 'role' : 'roles'} matched for you`}
                </span>
                <span className="jv-hero-item">
                  {hasResume ? 'Resume on file' : 'Upload your CV to get matched'}
                </span>
              </p>
            </div>
          </header>

          {searchBar}

          <div className="jv-body">
            <aside className="jv-side">
              {!hasResume && (
                <div className="jv-ai-card hero-reveal">
                  <div className="jv-ai-orbit" aria-hidden="true">
                    <span className="jv-ai-orbit__dot" />
                    <span className="jv-ai-orbit__dot" />
                    <span className="jv-ai-orbit__dot" />
                  </div>
                  <div className="jv-ai-card__head">
                    <span className="jv-ai-card__badge" aria-hidden="true">
                      <Icon name="sparkles-outline" style={{ fontSize: 17 }} />
                    </span>
                    <div>
                      <h2 className="jv-ai-card__title">Let AI find your ideal job</h2>
                      <p className="jv-ai-card__sub">Upload your CV and get matched instantly.</p>
                    </div>
                  </div>
                  <Link to={isAuthenticated ? '/cv' : '/register'} className="jv-dropzone">
                    <span className="jv-dropzone__scan" aria-hidden="true" />
                    <span className="jv-dropzone__icon" aria-hidden="true">
                      <Icon name="document-text-outline" style={{ fontSize: 22 }} />
                    </span>
                    <span className="jv-dropzone__label">Click to upload your CV</span>
                  </Link>
                  <div className="jv-ai-analyze" aria-hidden="true">
                    <span className="jv-ai-analyze__bar" />
                    <span className="jv-ai-analyze__text">
                      AI matching<span className="jv-ai-dots" />
                    </span>
                  </div>
                  <Link to={isAuthenticated ? '/cv' : '/register'} className="btn btn-indigo jv-ai-card__cta">
                    <Icon name="sparkles-outline" style={{ fontSize: 15 }} />
                    Get Matched
                  </Link>
                </div>
              )}

              <div className="jv-filters hero-reveal">
                <div className="jv-filters__head">
                  <span className="jv-filters__title">Filters</span>
                  <button type="button" onClick={clearFilters} disabled={!hasActiveFilters} className="clear-all">
                    Clear All
                  </button>
                </div>
                {filterControls}
              </div>
            </aside>

            <section className="jv-results">
              <div className="jv-results__head">
                <div className="jv-results__tabs">
                  <SlidingTabs tabs={categoryTabs} ariaLabel="Job category" />
                </div>
                <div className="jv-results__tools">
                  {canSortByMatch && <SlidingTabs tabs={sortTabs} ariaLabel="Sort jobs" />}
                  <Drawer>
                    <DrawerTrigger className="btn btn-ghost jv-filter-trigger">
                      <Icon name="options-outline" style={{ fontSize: 14 }} />
                      Filters
                      {activeFilterCount > 0 && <span className="pill mono">{activeFilterCount}</span>}
                    </DrawerTrigger>
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
                  <ViewToggle value={viewMode} onChange={setViewMode} />
                </div>
              </div>

              <div className="jv-results__meta">
                <span className="count">
                  <b>{jobsCountLabel}</b>
                </span>
                {category === 'government' && (
                  <span className="jv-govt-note">
                    From{' '}
                    <a href="https://alljobs.teletalk.com.bd/jobs/government" target="_blank" rel="noopener noreferrer">
                      alljobs.teletalk.com.bd
                    </a>
                  </span>
                )}
              </div>

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
              {internetMode && !error && (
                <div className="saved-banner">
                  <span>
                    <Icon name="globe-outline" style={{ fontSize: 15 }} />
                    Live roles from across the web, matched to your resume
                  </span>
                  <Link to="/jobs" className="btn btn-ghost btn-sm">
                    Back to feed
                  </Link>
                </div>
              )}

              {error && (
                <div className="mb-4">
                  <FormError message={error} />
                </div>
              )}

              {loading ? (
                <div className={containerClass} aria-hidden="true">
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <div className="tcard tcard--sk" key={i}>
                      <div className="tcard__top">
                        <div className="sk" style={{ width: 44, height: 44, borderRadius: '50%' }} />
                        <div className="sk" style={{ width: 28, height: 28, borderRadius: '50%' }} />
                      </div>
                      <div className="sk" style={{ width: '40%', marginTop: 16 }} />
                      <div className="sk" style={{ width: '70%', marginTop: 12, height: 16 }} />
                      <div className="sk sk-pills" style={{ marginTop: 14 }} />
                      <div className="sk" style={{ width: '45%', marginTop: 14 }} />
                    </div>
                  ))}
                </div>
              ) : mergedRows.length === 0 ? (
                internetMode && error ? null : (
                  <div className="lp-empty">
                    <div className="lp-empty-icon">
                      <Icon
                        name={savedMode ? 'briefcase-outline' : internetMode ? 'globe-outline' : 'search-outline'}
                        style={{ fontSize: 26 }}
                      />
                    </div>
                    {savedMode ? (
                      <>
                        <b>No saved jobs yet</b>
                        <span>Tap the bookmark on any job to save it here.</span>
                      </>
                    ) : category === 'mine' ? (
                      selectedLanguages.length > 0 ? (
                        <>
                          <b>No added jobs match these languages</b>
                          <span>Clear the language filter or add a job.</span>
                        </>
                      ) : (
                        <>
                          <b>You haven't added any jobs yet</b>
                          <span>Use “Add a job” to track roles you found elsewhere.</span>
                        </>
                      )
                    ) : internetMode ? (
                      <>
                        <b>No matching roles on the web right now</b>
                        <span>Try adjusting your search, or enrich your resume for better matches.</span>
                      </>
                    ) : (
                      <>
                        <b>No jobs found</b>
                        <span>Try widening your filters.</span>
                        {hasActiveFilters && (
                          <button type="button" className="lp-chip on lp-empty-reset" onClick={clearFilters}>
                            Clear filters
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )
              ) : (
                <div className={containerClass} key={listKey}>
                  {mergedRows.map((row, index) => renderCard(row, index))}
                </div>
              )}

              {!savedMode && !internetMode && category !== 'mine' && (
                <div className="jv-pager-row">
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
            </section>
          </div>
        </main>
      </div>
      <Footer />
    </div>
  )

}
