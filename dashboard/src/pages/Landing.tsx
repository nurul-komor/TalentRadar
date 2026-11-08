import { Icon } from '../components/Icon'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { PublicJobsSummary, JobSourceId, Job } from '@job-hunter/shared'
import { apiFetch } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { useCountUp } from '../hooks/useCountUp'
import { useScrollReveal } from '../hooks/useScrollReveal'
import { gsap } from '../lib/gsap'
import { PublicNav } from '../components/Nav'
import { Footer } from '../components/Footer'
import { ScoreRing } from '../components/ScoreRing'
import { Pill } from '../components/Pill'

const SOURCE_LABELS: Record<JobSourceId, string> = {
  remoteok: 'Remote OK',
  weworkremotely: 'We Work Remotely',
  himalayas: 'Himalayas',
  'teletalk-govt': 'alljobs.teletalk.com.bd',
  'brainstation-23': 'Brain Station 23',
  'riseup-labs': 'Riseup Labs',
  enosis: 'Enosis Solutions',
  bdtask: 'Bdtask',
  selise: 'SELISE Digital Platforms',
  bjit: 'BJIT Limited',
  cefalo: 'Cefalo Bangladesh',
  vivasoft: 'Vivasoft Limited',
  dsinnovators: 'Dynamic Solution Innovators',
  adzuna: 'Adzuna',
}

// Static illustrative cards for the hero's floating stack — not live data
// (the public landing page is logged-out, so there's no profile to score against).
const HERO_NOTICE_CARDS = [
  { seal: 'LX', sealColor: '#4453FF', role: 'Senior Backend Engineer', company: 'Lightbox Labs', score: 88, sourceLabel: 'Remote OK' },
  { seal: 'PV', sealColor: '#1FC9B7', role: 'Product Designer', company: 'Pavement', score: 74, sourceLabel: 'Himalayas' },
  { seal: 'NR', sealColor: '#6B78FF', role: 'DevRel Lead', company: 'Norther', score: 62, sourceLabel: 'WeWorkRemotely' },
] as const

// Filter chips for the "Freshly discovered" grid. Each maps to a predicate so the
// grid can re-stagger into place when the active filter changes.
type JobFilter = 'all' | 'remote' | 'govt' | 'recent'
const JOB_FILTERS: { id: JobFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'remote', label: 'Remote' },
  { id: 'govt', label: 'Government' },
  { id: 'recent', label: 'This week' },
]

type FeaturedJob = PublicJobsSummary['featuredJobs'][number]

function matchesFilter(job: FeaturedJob, filter: JobFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'govt') return job.sourceId === 'teletalk-govt'
  if (filter === 'remote') return job.sourceId !== 'teletalk-govt'
  // recent: discovered within the last 7 days
  const ageDays = (Date.now() - new Date(job.discoveredAt).getTime()) / (24 * 60 * 60 * 1000)
  return ageDays <= 7
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

// Debounces a value so the typeahead fires a request only after typing settles,
// mirroring the search box on the /jobs page.
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}

function relativeTimeFromNow(dateString: string): string {
  const diffDays = Math.round((Date.now() - new Date(dateString).getTime()) / (24 * 60 * 60 * 1000))
  if (diffDays <= 0) return 'today'
  if (diffDays === 1) return '1 day ago'
  if (diffDays < 30) return `${diffDays} days ago`
  const diffMonths = Math.round(diffDays / 30)
  return `${diffMonths} month${diffMonths === 1 ? '' : 's'} ago`
}

export function LandingPage() {
  const navigate = useNavigate()
  const { isAuthenticated } = useAuth()
  const [summary, setSummary] = useState<PublicJobsSummary | null>(null)
  const [keyword, setKeyword] = useState('')
  const [location, setLocation] = useState('')
  const heroRef = useRef<HTMLDivElement | null>(null)
  // Typeahead suggestions shown while typing in the hero search box — mirrors /jobs.
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const [suggestions, setSuggestions] = useState<Job[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [activeSuggestion, setActiveSuggestion] = useState(-1)
  // Landing-only interactive demos: a live filter on the featured grid and a
  // bookmark toggle on each card (local-only — the public page has no account).
  const [jobFilter, setJobFilter] = useState<JobFilter>('all')
  const [savedJobs, setSavedJobs] = useState<Set<string>>(new Set())

  useEffect(() => {
    apiFetch('/public/jobs-summary')
      .then((res) => (res.ok ? (res.json() as Promise<PublicJobsSummary>) : null))
      .then(setSummary)
      .catch(() => setSummary(null))
  }, [])

  // Short debounce keeps the dropdown feeling instant without a request per keystroke.
  const suggestKeyword = useDebouncedValue(keyword, 160)

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

  useEffect(() => {
    const container = heroRef.current
    if (!container) return
    if (prefersReducedMotion()) return

    const ctx = gsap.context(() => {
      // Staggered hero entrance — headline, lead, search and CTAs rise into place
      // with a soft focus-in for a more premium feel than a plain fade.
      gsap.from('.hero-reveal', {
        opacity: 0,
        y: 28,
        filter: 'blur(8px)',
        duration: 0.8,
        stagger: 0.1,
        ease: 'power3.out',
        delay: 0.08,
        clearProps: 'filter',
      })
    }, container)

    return () => ctx.revert()
  }, [])

  const statsRevealRef = useScrollReveal<HTMLDivElement>({ selector: '.reveal-stat' })
  const stepsRevealRef = useScrollReveal<HTMLDivElement>({ selector: '.reveal-step' })
  const sourcesRevealRef = useScrollReveal<HTMLDivElement>({ selector: '.reveal-source-chip' })
  const recheckRevealRef = useScrollReveal<HTMLDivElement>({ selector: '.rc', stagger: 0.12 })
  // Application-success strip: nodes light up in sequence as the row scrolls in.
  const trackRevealRef = useScrollReveal<HTMLDivElement>({ selector: '.tnode', stagger: 0.14 })

  function goToJobs(params: Record<string, string>) {
    const search = new URLSearchParams(params).toString()
    navigate(search ? `/jobs?${search}` : '/jobs')
  }

  function commitSuggestion(job: Job) {
    setShowSuggestions(false)
    if (job._id) navigate(`/jobs/${job._id}`)
  }

  function toggleSaved(id: string, event: ReactMouseEvent) {
    // The card itself is a <Link>; don't navigate when the bookmark is clicked.
    event.preventDefault()
    event.stopPropagation()
    setSavedJobs((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
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

  const totalJobsCount = useCountUp(summary ? summary.totalJobs : null)
  const sourceCount = summary?.bySource.length ?? null
  const sourcesCount = useCountUp(sourceCount)

  const featuredJobs = summary?.featuredJobs ?? []
  const filteredJobs = useMemo(
    () => featuredJobs.filter((job) => matchesFilter(job, jobFilter)),
    [featuredJobs, jobFilter],
  )

  return (
    <div className="page-enter">
      <PublicNav />

      <section ref={heroRef} className="hero hero-bleed">
        <div className="hero-bg" />
        <div className="hero-aurora" aria-hidden="true" />
        <div className="hero-glow" />
        <div className="wrap hero-grid">
          <div>
            <span className="hero-reveal eyebrow">
              <span className="tag">Verified</span>
              Every listing re-checked against its source page
            </span>

            <h1 className="hero-reveal">
              Job boards lie. We don't.
              <br />
              <em>Verified</em> remote roles &amp; government circulars.
            </h1>
            <p className="hero-reveal lead">
              We discover remote roles and Bangladesh government circulars, re-check each one against
              its live source, then score the match against your profile. You only spend time on roles
              worth applying to.
            </p>

            <form
              className="hero-reveal search-card relative z-20"
              onSubmit={(e) => {
                e.preventDefault()
                const params: Record<string, string> = {}
                if (keyword.trim()) params.q = keyword.trim()
                if (location.trim()) params.location = location.trim()
                goToJobs(params)
              }}
            >
              <div className="search-field">
                <Icon name="search-outline" style={{ fontSize: 17 }} />
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Role or keyword"
                  aria-label="Role or keyword"
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
                  aria-controls="hero-search-suggestions"
                  aria-autocomplete="list"
                />
              </div>
              <div className="search-field">
                <Icon name="location-outline" style={{ fontSize: 17 }} />
                <input
                  type="text"
                  placeholder="Anywhere / timezone"
                  aria-label="Location or timezone"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                />
              </div>
              <button type="submit" className="btn btn-indigo">
                Explore jobs
              </button>

              {showSuggestions && suggestions.length > 0 && (
                <ul
                  id="hero-search-suggestions"
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
            </form>

            <div className="hero-reveal hero-ctas">
              <Link to="/register" className="btn btn-ghost btn-lg">
                Create your profile
              </Link>
            </div>
            <div className="hero-reveal hero-note">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
              <span>
                Sourced today from{' '}
                <span className="sources">Himalayas · Remote OK · We Work Remotely</span>
              </span>
            </div>
          </div>

          <div className="hero-reveal stack" aria-hidden="true">
            {HERO_NOTICE_CARDS.map((card, index) => (
              <div className={`fcard c${index + 1}`} key={card.company}>
                <div className="fcard-top">
                  <div className="fcard-co">
                    <span
                      className="logo-chip"
                      style={{ width: 36, height: 36, fontSize: 13, background: card.sealColor }}
                    >
                      {card.seal}
                    </span>
                    <div>
                      <div className="fcard-role">{card.role}</div>
                      <div className="fcard-co-name">{card.company}</div>
                    </div>
                  </div>
                  <ScoreRing score={card.score} size={40} strokeWidth={4} />
                </div>
                {/* AI match-score progress — fills on mount to visualise scoring. */}
                <div className="fcard-match">
                  <span className="fcard-match-label">AI match</span>
                  <span className="fcard-match-track">
                    <i style={{ '--match-w': `${card.score}%`, animationDelay: `${0.5 + index * 0.18}s` } as CSSProperties} />
                  </span>
                </div>
                <div className="fcard-meta">
                  <Pill tone="verified">Verified open</Pill>
                  <Pill tone="mono">{card.sourceLabel}</Pill>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="band band-alt">
        <div className="wrap">
          {summary ? (
            <div ref={statsRevealRef} className="stat-grid">
              <div className="stat reveal-stat">
                <div className="k">Discovery</div>
                <div className="n mono">{totalJobsCount.toLocaleString()}</div>
                <div className="l">Jobs discovered in total</div>
              </div>
              <div className="stat reveal-stat">
                <div className="k">Coverage</div>
                <div className="n mono">{sourcesCount}</div>
                <div className="l">Active sources</div>
              </div>
              <div className="stat reveal-stat">
                <div className="k">Verification</div>
                <div className="n mono">0</div>
                <div className="l">Verified open rate</div>
              </div>
              <div className="stat reveal-stat">
                <div className="k">Matching</div>
                <div className="n mono">0</div>
                <div className="l">Avg. match score of applied jobs</div>
              </div>
            </div>
          ) : (
            // Skeleton while the live summary loads.
            <div className="stat-grid" aria-hidden="true">
              {[0, 1, 2, 3].map((i) => (
                <div className="stat" key={i}>
                  <div className="sk sk-line" style={{ width: '40%' }} />
                  <div className="sk sk-stat-n" />
                  <div className="sk sk-line" style={{ width: '70%' }} />
                </div>
              ))}
            </div>
          )}
          <div className="placeholder-note">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v5M12 16h.01" strokeLinecap="round" />
            </svg>
            Verification rate and match score require a signed-in profile — the two figures above are live.
          </div>
        </div>
      </section>

      <section className="band">
        <div className="wrap">
          <div className="section-head">
            <div className="kicker">Freshly discovered</div>
            <h2>Recently discovered, already verified.</h2>
            <p>What's landed in the feed. Each one is re-checked against its source page before it ever reaches a score.</p>
          </div>

          {/* Live filter — re-staggers the grid as the active chip changes. */}
          {summary && featuredJobs.length > 0 && (
            <div className="lp-filters" role="tablist" aria-label="Filter featured jobs">
              {JOB_FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  role="tab"
                  aria-selected={jobFilter === f.id}
                  className={`lp-chip ${jobFilter === f.id ? 'on' : ''}`}
                  onClick={() => setJobFilter(f.id)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}

          {!summary ? (
            // Skeleton cards while loading.
            <div className="jobs-grid" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <div className="jobcard lp-skel-card" key={i}>
                  <div className="sk sk-line" style={{ width: '70%', height: 16 }} />
                  <div className="sk sk-line" style={{ width: '45%' }} />
                  <div className="sk sk-pills" />
                  <div className="sk sk-line" style={{ width: '100%', marginTop: 18 }} />
                </div>
              ))}
            </div>
          ) : featuredJobs.length === 0 ? (
            <div className="lp-empty">
              <div className="lp-empty-icon">
                <Icon name="briefcase-outline" style={{ fontSize: 26 }} />
              </div>
              <b>No verified jobs yet</b>
              <span>Fresh roles land here as soon as they clear verification — check back soon.</span>
            </div>
          ) : filteredJobs.length === 0 ? (
            <div className="lp-empty">
              <div className="lp-empty-icon">
                <Icon name="search-outline" style={{ fontSize: 26 }} />
              </div>
              <b>Nothing in this slice</b>
              <span>No freshly discovered roles match “{JOB_FILTERS.find((f) => f.id === jobFilter)?.label}” right now.</span>
              <button type="button" className="lp-chip on lp-empty-reset" onClick={() => setJobFilter('all')}>
                Show all
              </button>
            </div>
          ) : (
            // key on the filter so the grid remounts and re-runs its stagger-in.
            <div className="jobs-grid" key={jobFilter}>
              {filteredJobs.map((job, index) => {
                const isSaved = savedJobs.has(job._id)
                return (
                  <Link
                    to="/jobs"
                    key={job._id}
                    className="jobcard lp-jobcard"
                    style={{ '--i': index } as CSSProperties}
                  >
                    <div className="top">
                      <div>
                        <div className="role">{job.title}</div>
                        <div className="co">
                          <Icon name="business-outline" style={{ fontSize: 12, display: 'inline-block', verticalAlign: 'middle', marginRight: 4 }} />
                          {job.company}
                          {job.location ? ` · ${job.location}` : ''}
                        </div>
                      </div>
                      <button
                        type="button"
                        className={`lp-save ${isSaved ? 'on' : ''}`}
                        aria-pressed={isSaved}
                        aria-label={isSaved ? 'Remove bookmark' : 'Save job'}
                        onClick={(e) => toggleSaved(job._id, e)}
                      >
                        <svg viewBox="0 0 24 24" fill={isSaved ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                        </svg>
                      </button>
                    </div>
                    <div className="tags">
                      <Pill tone="verified">Verified</Pill>
                      <Pill tone="mono">{SOURCE_LABELS[job.sourceId]}</Pill>
                    </div>
                    <div className="foot">
                      <span className="src">{relativeTimeFromNow(job.discoveredAt)}</span>
                      <span className="apply">View role <span className="apply-arrow">→</span></span>
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </div>
      </section>

      <section className="band band-alt">
        <div className="wrap">
          <div className="section-head center" style={{ margin: '0 auto 56px' }}>
            <div className="kicker">How it works</div>
            <h2>Four steps, one human approval gate.</h2>
            <p>Nothing gets submitted on your behalf without you clicking confirm. Every time.</p>
          </div>
          <div ref={stepsRevealRef} className="steps">
            <div className="step reveal-step">
              <div className="step-icon">
                <Icon name="search-outline" style={{ fontSize: 18 }} />
              </div>
              <div className="idx">01 / DISCOVER</div>
              <h3>Discover</h3>
              <p>Adapters pull candidate postings from each source continuously.</p>
            </div>
            <div className="step reveal-step">
              <div className="step-icon">
                <Icon name="briefcase-outline" style={{ fontSize: 18 }} />
              </div>
              <div className="idx">02 / VERIFY</div>
              <h3>Verify</h3>
              <p>Each listing is re-checked against its live source page. A 200 alone proves nothing.</p>
            </div>
            <div className="step reveal-step">
              <div className="step-icon">
                <ScoreRing score={88} size={18} strokeWidth={2} />
              </div>
              <div className="idx">03 / SCORE</div>
              <h3>Score</h3>
              <p>Weighted matching against your profile. Unknowns pull the score down, never ignored.</p>
            </div>
            <div className="step reveal-step">
              <div className="step-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 12l6 6L20 6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div className="idx">04 / APPROVE</div>
              <h3>Approve &amp; apply</h3>
              <p>Review tailored materials, then confirm. That click is what submits.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="band">
        <div className="wrap">
          <div className="section-head">
            <div className="kicker">Where it looks</div>
            <h2>Sources, plain and honest.</h2>
            <p>We only show integrations that are actually live. Nothing here is aspirational.</p>
          </div>
          <div ref={sourcesRevealRef} className="sources-row">
            {(summary?.bySource ?? []).map((entry) => (
              <span className="source-chip reveal-source-chip" key={entry.sourceId}>
                <span className="dot" />
                {SOURCE_LABELS[entry.sourceId]}
                {entry.sourceId === 'teletalk-govt' && (
                  <Pill tone="govt">Government</Pill>
                )}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="band cta-band">
        <div className="hero-glow" />
        <div className="wrap" style={{ position: 'relative', zIndex: 1 }}>
          <h2>Stop refreshing ten job boards a day.</h2>
          <p>Build your profile once. Let verification and scoring do the filtering.</p>
          <div className="hero-ctas">
            <Link to="/jobs" className="btn btn-indigo btn-lg">
              Explore jobs
            </Link>
            <Link to={isAuthenticated ? '/dashboard' : '/register'} className="btn btn-ghost btn-lg">
              {isAuthenticated ? 'Go to dashboard' : 'Create your profile'}
            </Link>
          </div>
        </div>
      </section>

      <section className="band">
        <div className="wrap">
          <div className="section-head center">
            <div className="kicker">Verification</div>
            <h2>Every listing is re-checked before it reaches you.</h2>
            <p>We re-fetch the source page and confirm the application form is still live before a job counts as verified.</p>
          </div>
          <div ref={recheckRevealRef} className="recheck-card">
            <div className="rc">
              <div className="t">Source page</div>
              <div className="line">GET remoteok.com/l/...<br />200 OK · 1.2s</div>
            </div>
            <svg className="arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 12h14M13 5l7 7-7 7" />
            </svg>
            <div className="rc">
              <div className="t">Form check</div>
              <div className="line">
                <span className="ok">Apply form present</span>
                <br />
                <span className="ok">No "position filled" text</span>
              </div>
            </div>
            <svg className="arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 12h14M13 5l7 7-7 7" />
            </svg>
            <div className="rc verdict">
              <div className="t">Verdict</div>
              <div className="big">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
                Verified open
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="band band-alt">
        <div className="wrap">
          <div className="section-head center">
            <div className="kicker">Tracking</div>
            <h2>See exactly where every application stands.</h2>
            <p>From drafted materials to a submitted application, nothing moves without your confirmation.</p>
          </div>
          <div ref={trackRevealRef} className="track-strip">
            <div className="tnode done">
              <div className="dot">1</div>
              <b>Draft</b>
              <span>Application created</span>
            </div>
            <div className="tnode done">
              <div className="dot">2</div>
              <b>Materials ready</b>
              <span>Cover letter drafted</span>
            </div>
            <div className="tnode you">
              <div className="dot">3</div>
              <b>Your review</b>
              <span>Nothing sends without you</span>
            </div>
            <div className="tnode">
              <div className="dot">4</div>
              <b>Submitted</b>
              <span>Tracked to the source</span>
            </div>
            <div className="tnode success">
              <div className="dot">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              </div>
              <b>Outcome</b>
              <span>Logged for your records</span>
            </div>
          </div>
        </div>
      </section>

      <section className="band">
        <div className="wrap">
          <div className="showcase">
            <div>
              <div className="kicker">CV intelligence</div>
              <h2>Upload once. We extract the rest.</h2>
              <p className="lead">
                Drop in a PDF or DOCX and your skills, experience, and education are parsed automatically — ready to
                match against every job in your feed.
              </p>
            </div>
            <div className="cvdemo">
              <div className="thumb">
                <span className="scan" aria-hidden="true" />
                <i />
                <i />
                <i />
              </div>
              <div className="kv">
                <div>
                  <span className="t">Skills found</span>
                  <span className="v">12</span>
                </div>
                <div>
                  <span className="t">Experience</span>
                  <span className="v">3 roles</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="band band-alt">
        <div className="wrap">
          <div className="duo">
            <div className="tilex a">
              <div>
                <div className="kicker">Remote, global</div>
                <h3>Built for remote-first roles.</h3>
                <p>Remote OK, We Work Remotely, and Himalayas feed in continuously.</p>
              </div>
            </div>
            <div className="tilex b">
              <div>
                <div className="kicker">Bangladesh</div>
                <h3>Government jobs, included.</h3>
                <p>Verified listings from alljobs.teletalk.com.bd, tagged so you can filter them separately.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  )
}
