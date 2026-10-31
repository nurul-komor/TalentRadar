import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Briefcase, Building2, Globe2, MapPin, Search, Sparkles } from 'lucide-react'
import type { PublicJobsSummary, JobSourceId } from '@job-hunter/shared'
import { apiFetch } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { useCountUp } from '../hooks/useCountUp'
import { useScrollReveal } from '../hooks/useScrollReveal'
import { gsap } from '../lib/gsap'
import { Button } from '../components/Button'

const NAV_LINKS = ['Demos', 'Companies', 'Candidates', 'Blog', 'Pages']

const SOURCE_IDS: JobSourceId[] = ['remoteok', 'weworkremotely', 'himalayas']

const SOURCE_LABELS: Record<JobSourceId, string> = {
  remoteok: 'Remote OK',
  weworkremotely: 'We Work Remotely',
  himalayas: 'Himalayas',
}

const SOURCE_ICONS: Record<JobSourceId, typeof Globe2> = {
  remoteok: Globe2,
  weworkremotely: Briefcase,
  himalayas: MapPin,
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
  const [scrolled, setScrolled] = useState(false)
  const heroRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    apiFetch('/public/jobs-summary')
      .then((res) => (res.ok ? (res.json() as Promise<PublicJobsSummary>) : null))
      .then(setSummary)
      .catch(() => setSummary(null))
  }, [])

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
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

  const sourceRevealRef = useScrollReveal<HTMLDivElement>({ selector: '.reveal-source-card' })
  const jobsRevealRef = useScrollReveal<HTMLDivElement>({ selector: '.reveal-job-card' })

  function goToJobs(params: Record<string, string>) {
    const search = new URLSearchParams(params).toString()
    navigate(search ? `/jobs?${search}` : '/jobs')
  }

  const countBySourceId = Object.fromEntries(
    (summary?.bySource ?? []).map((entry) => [entry.sourceId, entry.count])
  ) as Partial<Record<JobSourceId, number>>

  const totalJobsCount = useCountUp(summary ? summary.totalJobs : null)
  const remoteOkCount = useCountUp(summary ? (countBySourceId.remoteok ?? 0) : null)
  const wwrCount = useCountUp(summary ? (countBySourceId.weworkremotely ?? 0) : null)
  const himalayasCount = useCountUp(summary ? (countBySourceId.himalayas ?? 0) : null)
  const statCounts: Record<JobSourceId, number> = {
    remoteok: remoteOkCount,
    weworkremotely: wwrCount,
    himalayas: himalayasCount,
  }

  return (
    <div className="min-h-screen bg-white">
      <header
        className={`sticky top-0 z-30 border-b transition-colors ${
          scrolled
            ? 'border-slate-200 bg-white/80 backdrop-blur-lg shadow-sm'
            : 'border-transparent bg-transparent'
        }`}
      >
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4">
          <span className={`text-lg font-bold ${scrolled ? 'text-slate-900' : 'text-white'}`}>
            AI Remote Job Hunter
          </span>
          <nav
            className={`hidden items-center gap-8 text-sm font-medium md:flex ${
              scrolled ? 'text-slate-600' : 'text-white/70'
            }`}
          >
            <Link to="/jobs" className={scrolled ? 'hover:text-slate-900' : 'hover:text-white'}>
              Find Jobs
            </Link>
            {NAV_LINKS.map((label) => (
              <span key={label} className="cursor-default opacity-60">
                {label}
              </span>
            ))}
          </nav>
          <Button
            variant="primary"
            className="rounded-full"
            onClick={() => navigate(isAuthenticated ? '/jobs' : '/login')}
          >
            {isAuthenticated ? 'Go to Jobs' : 'Sign in'}
          </Button>
        </div>
      </header>

      <section ref={heroRef} className="relative -mt-16 overflow-hidden bg-slate-950 pt-16">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -left-24 top-10 size-[28rem] animate-[blob-float_18s_ease-in-out_infinite] rounded-full bg-indigo-600/40 blur-3xl" />
          <div
            className="absolute right-0 top-1/3 size-[26rem] animate-[blob-float_22s_ease-in-out_infinite] rounded-full bg-violet-600/30 blur-3xl"
            style={{ animationDelay: '-6s' }}
          />
          <div
            className="absolute bottom-0 left-1/3 size-[22rem] animate-[blob-float_20s_ease-in-out_infinite] rounded-full bg-blue-500/20 blur-3xl"
            style={{ animationDelay: '-11s' }}
          />
        </div>

        <div className="relative mx-auto grid max-w-7xl gap-10 px-4 py-20 lg:grid-cols-2 lg:items-center lg:py-32">
          <div>
            <span className="hero-reveal inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-white/80 backdrop-blur">
              <Sparkles size={14} className="text-indigo-300" />
              AI-powered remote job discovery
            </span>

            <h1 className="hero-reveal mt-5 text-4xl font-extrabold leading-tight tracking-tight text-white sm:text-5xl lg:text-6xl">
              Find the perfect job for you
            </h1>
            <p className="hero-reveal mt-4 max-w-md text-white/70">
              Search your next remote opportunity through {totalJobsCount.toLocaleString()} tracked jobs
            </p>

            <form
              onSubmit={(e) => {
                e.preventDefault()
                goToJobs(keyword.trim() ? { q: keyword.trim() } : {})
              }}
              className="hero-reveal mt-8 flex max-w-xl items-center gap-2 rounded-full border border-white/15 bg-white/10 p-2 shadow-xl backdrop-blur-xl"
            >
              <Search size={18} className="ml-2 shrink-0 text-white/50" />
              <input
                type="text"
                placeholder="Job title or keyword"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                className="w-full min-w-0 border-none bg-transparent px-1 py-2 text-sm text-white outline-none placeholder:text-white/40"
              />
              <Button type="submit" className="rounded-full">
                Search
              </Button>
            </form>

            <div className="hero-reveal mt-6 flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium text-white/80">Popular:</span>
              {['engineer', 'designer', 'writer', 'fullstack', 'devops', 'frontend'].map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => goToJobs({ q: tag })}
                  className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-white/80 backdrop-blur transition-colors hover:bg-white/20"
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>

          <div className="hero-reveal relative mx-auto w-full max-w-sm">
            <div className="aspect-[4/5] rounded-2xl border border-white/10 bg-gradient-to-br from-indigo-500/30 via-violet-500/20 to-slate-900 shadow-2xl backdrop-blur-sm" />
            <div className="absolute -bottom-6 -left-6 w-56 rounded-xl border border-white/15 bg-white/10 p-4 shadow-xl backdrop-blur-xl sm:-left-10">
              <ul className="flex flex-col gap-3">
                {SOURCE_IDS.map((sourceId) => (
                  <li key={sourceId}>
                    <p className="text-lg font-bold text-white">{statCounts[sourceId]}</p>
                    <p className="text-xs text-white/60">verified jobs on {SOURCE_LABELS[sourceId]}</p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16">
        <h2 className="text-2xl font-bold text-slate-900">Browse by Source</h2>
        <p className="mt-1 text-sm text-slate-500">Search your career opportunity across every tracked source</p>

        <div ref={sourceRevealRef} className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {(summary?.bySource ?? SOURCE_IDS.map((sourceId) => ({ sourceId, count: 0 }))).map((entry) => {
            const Icon = SOURCE_ICONS[entry.sourceId]
            return (
              <button
                key={entry.sourceId}
                type="button"
                onClick={() => goToJobs({ sourceId: entry.sourceId })}
                className="reveal-source-card group flex flex-col items-start gap-3 rounded-2xl border border-slate-200/80 bg-white/60 p-6 text-left shadow-sm backdrop-blur-xl transition-all hover:-translate-y-1 hover:border-indigo-200 hover:shadow-lg hover:shadow-indigo-100"
              >
                <span className="flex size-10 items-center justify-center rounded-full bg-indigo-50 shadow-sm transition-colors group-hover:bg-indigo-100">
                  <Icon size={18} className="text-indigo-600" />
                </span>
                <span className="font-semibold text-slate-900">{SOURCE_LABELS[entry.sourceId]}</span>
                <span className="text-sm text-slate-500">{entry.count} open positions</span>
              </button>
            )
          })}
        </div>
      </section>

      <section className="bg-gradient-to-b from-slate-50 to-white py-16">
        <div className="mx-auto max-w-7xl px-4">
          <h2 className="text-2xl font-bold text-slate-900">Featured Job Offers</h2>
          <p className="mt-1 text-sm text-slate-500">The latest verified roles we've found for you</p>

          {summary && summary.featuredJobs.length === 0 && (
            <p className="mt-8 rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
              No verified jobs yet — check back soon.
            </p>
          )}

          <div ref={jobsRevealRef} className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {(summary?.featuredJobs ?? []).map((job) => (
              <Link
                key={job._id}
                to="/jobs"
                className="reveal-job-card flex flex-col gap-3 rounded-2xl border border-slate-200/80 bg-white/70 p-5 shadow-sm backdrop-blur-xl transition-all hover:-translate-y-1 hover:shadow-lg hover:shadow-indigo-100"
              >
                <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700">
                  {SOURCE_LABELS[job.sourceId]}
                </span>
                <span className="font-semibold text-slate-900">{job.title}</span>
                <span className="flex items-center gap-1.5 text-sm text-slate-600">
                  <Building2 size={14} className="text-slate-400" />
                  {job.company}
                </span>
                {job.location && (
                  <span className="flex items-center gap-1.5 text-sm text-slate-600">
                    <MapPin size={14} className="text-slate-400" />
                    {job.location}
                  </span>
                )}
                <span className="text-xs text-slate-400">{relativeTimeFromNow(job.discoveredAt)}</span>
              </Link>
            ))}
          </div>

          <Button variant="primary" className="mt-8 rounded-full" onClick={() => navigate('/jobs')}>
            All Job Offers
          </Button>
        </div>
      </section>
    </div>
  )
}
