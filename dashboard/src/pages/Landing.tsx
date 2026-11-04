import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Briefcase, Building2, MapPin, Search } from 'lucide-react'
import type { PublicJobsSummary, JobSourceId } from '@job-hunter/shared'
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
}

// Static illustrative cards for the hero's floating stack — not live data
// (the public landing page is logged-out, so there's no profile to score against).
const HERO_NOTICE_CARDS = [
  { seal: 'LX', sealColor: '#4453FF', role: 'Senior Backend Engineer', company: 'Lightbox Labs', score: 88, sourceLabel: 'Remote OK' },
  { seal: 'PV', sealColor: '#1FC9B7', role: 'Product Designer', company: 'Pavement', score: 74, sourceLabel: 'Himalayas' },
  { seal: 'NR', sealColor: '#6B78FF', role: 'DevRel Lead', company: 'Norther', score: 62, sourceLabel: 'WeWorkRemotely' },
] as const

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

  useEffect(() => {
    apiFetch('/public/jobs-summary')
      .then((res) => (res.ok ? (res.json() as Promise<PublicJobsSummary>) : null))
      .then(setSummary)
      .catch(() => setSummary(null))
  }, [])

  useEffect(() => {
    const container = heroRef.current
    if (!container) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const ctx = gsap.context(() => {
      gsap.from('.hero-reveal', {
        opacity: 0,
        y: 24,
        duration: 0.7,
        stagger: 0.12,
        ease: 'power2.out',
        delay: 0.1,
      })
    }, container)

    return () => ctx.revert()
  }, [])

  const statsRevealRef = useScrollReveal<HTMLDivElement>({ selector: '.reveal-stat' })
  const jobsRevealRef = useScrollReveal<HTMLDivElement>({ selector: '.reveal-job-card' })
  const stepsRevealRef = useScrollReveal<HTMLDivElement>({ selector: '.reveal-step' })
  const sourcesRevealRef = useScrollReveal<HTMLDivElement>({ selector: '.reveal-source-chip' })

  function goToJobs(params: Record<string, string>) {
    const search = new URLSearchParams(params).toString()
    navigate(search ? `/jobs?${search}` : '/jobs')
  }

  const totalJobsCount = useCountUp(summary ? summary.totalJobs : null)
  const sourceCount = summary?.bySource.length ?? null
  const sourcesCount = useCountUp(sourceCount)

  return (
    <div>
      <PublicNav />

      <section ref={heroRef} className="hero">
        <div className="hero-bg" />
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
              className="hero-reveal search-card"
              onSubmit={(e) => {
                e.preventDefault()
                const params: Record<string, string> = {}
                if (keyword.trim()) params.q = keyword.trim()
                if (location.trim()) params.location = location.trim()
                goToJobs(params)
              }}
            >
              <div className="search-field">
                <Search size={17} />
                <input
                  type="text"
                  placeholder="Role or keyword"
                  aria-label="Role or keyword"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                />
              </div>
              <div className="search-field">
                <MapPin size={17} />
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

          {summary && summary.featuredJobs.length === 0 && (
            <p className="placeholder-note">No verified jobs yet — check back soon.</p>
          )}

          <div ref={jobsRevealRef} className="jobs-grid">
            {(summary?.featuredJobs ?? []).map((job) => (
              <Link to="/jobs" key={job._id} className="jobcard reveal-job-card">
                <div className="top">
                  <div>
                    <div className="role">{job.title}</div>
                    <div className="co">
                      <Building2 size={12} style={{ display: 'inline', marginRight: 4 }} />
                      {job.company}
                      {job.location ? ` · ${job.location}` : ''}
                    </div>
                  </div>
                </div>
                <div className="tags">
                  <Pill tone="verified">Verified</Pill>
                  <Pill tone="mono">{SOURCE_LABELS[job.sourceId]}</Pill>
                </div>
                <div className="foot">
                  <span className="src">{relativeTimeFromNow(job.discoveredAt)}</span>
                  <span className="apply">View role →</span>
                </div>
              </Link>
            ))}
          </div>
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
                <Search size={18} />
              </div>
              <div className="idx">01 / DISCOVER</div>
              <h3>Discover</h3>
              <p>Adapters pull candidate postings from each source continuously.</p>
            </div>
            <div className="step reveal-step">
              <div className="step-icon">
                <Briefcase size={18} />
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
          <div className="recheck-card">
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
          <div className="track-strip">
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
            <div className="tnode">
              <div className="dot">5</div>
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
