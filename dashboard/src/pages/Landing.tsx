import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Briefcase, Building2, Globe2, MapPin, Search } from 'lucide-react'
import type { PublicJobsSummary, JobSourceId } from '@job-hunter/shared'
import { apiFetch } from '../api/client'
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
  const [summary, setSummary] = useState<PublicJobsSummary | null>(null)
  const [keyword, setKeyword] = useState('')

  useEffect(() => {
    apiFetch('/public/jobs-summary')
      .then((res) => (res.ok ? (res.json() as Promise<PublicJobsSummary>) : null))
      .then(setSummary)
      .catch(() => setSummary(null))
  }, [])

  function goToJobs(params: Record<string, string>) {
    const search = new URLSearchParams(params).toString()
    navigate(search ? `/jobs?${search}` : '/jobs')
  }

  const totalJobsLabel = summary ? summary.totalJobs.toLocaleString() : '—'

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4">
          <span className="text-lg font-bold text-slate-900">AI Remote Job Hunter</span>
          <nav className="hidden items-center gap-8 text-sm font-medium text-slate-600 md:flex">
            <Link to="/jobs" className="hover:text-slate-900">
              Find Jobs
            </Link>
            {NAV_LINKS.map((label) => (
              <span key={label} className="cursor-default text-slate-400">
                {label}
              </span>
            ))}
          </nav>
          <Button variant="primary" className="rounded-full" onClick={() => navigate('/login')}>
            Sign in
          </Button>
        </div>
      </header>

      <section className="bg-slate-50">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-16 lg:grid-cols-2 lg:items-center lg:py-24">
          <div>
            <h1 className="text-4xl font-extrabold leading-tight text-slate-900 sm:text-5xl">
              Find the perfect job for you
            </h1>
            <p className="mt-4 text-slate-600">
              Search your next remote opportunity through {totalJobsLabel} tracked jobs
            </p>

            <form
              onSubmit={(e) => {
                e.preventDefault()
                goToJobs(keyword.trim() ? { q: keyword.trim() } : {})
              }}
              className="mt-8 flex max-w-xl items-center gap-2 rounded-full border border-slate-300 bg-white p-2 shadow-sm"
            >
              <Search size={18} className="ml-2 shrink-0 text-slate-400" />
              <input
                type="text"
                placeholder="Job title or keyword"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                className="w-full min-w-0 border-none bg-transparent px-1 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400"
              />
              <Button type="submit" className="rounded-full">
                Search
              </Button>
            </form>

            <div className="mt-6 flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium text-slate-900">Popular:</span>
              {['engineer', 'designer', 'writer', 'fullstack', 'devops', 'frontend'].map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => goToJobs({ q: tag })}
                  className="rounded-full bg-blue-50 px-3 py-1 text-blue-700 hover:bg-blue-100"
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-sm">
            <div className="aspect-[4/5] rounded-2xl bg-gradient-to-br from-blue-600 to-slate-900 shadow-xl" />
            <div className="absolute -bottom-6 -left-6 w-56 rounded-xl border border-slate-200 bg-white p-4 shadow-lg sm:-left-10">
              <ul className="flex flex-col gap-3">
                {(summary?.bySource ?? []).slice(0, 3).map((entry) => (
                  <li key={entry.sourceId}>
                    <p className="text-lg font-bold text-slate-900">{entry.count}</p>
                    <p className="text-xs text-slate-500">verified jobs on {SOURCE_LABELS[entry.sourceId]}</p>
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

        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {(summary?.bySource ?? SOURCE_IDS.map((sourceId) => ({ sourceId, count: 0 }))).map(
            (entry) => {
              const Icon = SOURCE_ICONS[entry.sourceId]
              return (
                <button
                  key={entry.sourceId}
                  type="button"
                  onClick={() => goToJobs({ sourceId: entry.sourceId })}
                  className="flex flex-col items-start gap-3 rounded-xl bg-slate-50 p-6 text-left transition-colors hover:bg-blue-50"
                >
                  <span className="flex size-10 items-center justify-center rounded-full bg-white shadow-sm">
                    <Icon size={18} className="text-slate-700" />
                  </span>
                  <span className="font-semibold text-slate-900">{SOURCE_LABELS[entry.sourceId]}</span>
                  <span className="text-sm text-slate-500">{entry.count} open positions</span>
                </button>
              )
            }
          )}
        </div>
      </section>

      <section className="bg-amber-50 py-16">
        <div className="mx-auto max-w-7xl px-4">
          <h2 className="text-2xl font-bold text-slate-900">Featured Job Offers</h2>
          <p className="mt-1 text-sm text-slate-500">The latest verified roles we've found for you</p>

          {summary && summary.featuredJobs.length === 0 && (
            <p className="mt-8 rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
              No verified jobs yet — check back soon.
            </p>
          )}

          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {(summary?.featuredJobs ?? []).map((job) => (
              <Link
                key={job._id}
                to="/jobs"
                className="flex flex-col gap-3 rounded-xl bg-white p-5 shadow-sm transition-shadow hover:shadow-md"
              >
                <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
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
