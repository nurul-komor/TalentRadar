import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { JobSourceId, PublicJobsSummary } from '@job-hunter/shared'
import { apiFetch } from '../api/client'
import { PublicNav } from '../components/Nav'
import { Footer } from '../components/Footer'
import { Pill } from '../components/Pill'
import { Icon } from '../components/Icon'
import { useScrollReveal } from '../hooks/useScrollReveal'
import { useCountUp } from '../hooks/useCountUp'

interface SourceInfo {
  label: string
  initials: string
  color: string
  // The concrete integration behind the source — real metadata, not decoration.
  method: string
  description: string
  isGovt?: boolean
}

const SOURCES: Record<JobSourceId, SourceInfo> = {
  remoteok: {
    label: 'Remote OK',
    initials: 'OK',
    color: '#4453FF',
    method: 'Public JSON API',
    description:
      "A general remote-jobs board. We pull their public job API directly — title, company, description, location, salary when it's listed, and posting date.",
  },
  weworkremotely: {
    label: 'We Work Remotely',
    initials: 'WWR',
    color: '#1FC9B7',
    method: 'RSS feed',
    description:
      'We parse the public RSS feed for their remote-programming-jobs category. Company and title come from a single listing field, split on the colon they always use between them.',
  },
  himalayas: {
    label: 'Himalayas',
    initials: 'HI',
    color: '#6B78FF',
    method: 'Public JSON API',
    description:
      'Another general remote board, pulled from their public jobs API — the same shape as Remote OK: title, company, description, salary range, and location restrictions when the listing specifies them.',
  },
  adzuna: {
    label: 'Adzuna',
    initials: 'AZ',
    color: '#7A5CFF',
    method: 'Aggregator API',
    description:
      'A job-search aggregator that indexes listings from across the web. We pull their public job API — title, company, location, salary estimates when available, and posting date.',
  },
  'brainstation-23': {
    label: 'Brain Station 23',
    initials: 'BS',
    color: '#2FC1E1',
    method: 'easy.jobs ATS',
    description:
      "A Bangladesh software firm that recruits through the easy.jobs ATS rather than a general board. We pull its public career API directly — title, full job description, and location — and fetch each posting's detail page for the description the scoring pipeline needs.",
  },
  'riseup-labs': {
    label: 'Riseup Labs',
    initials: 'RL',
    color: '#1A6CFF',
    method: 'WordPress REST',
    description:
      'A Bangladesh software and game studio. Its careers section runs on WordPress, so we pull the jobs straight from the public WP REST API — title, permalink, publish date, and the full HTML body.',
  },
  enosis: {
    label: 'Enosis Solutions',
    initials: 'EN',
    color: '#00A36C',
    method: 'Pinpoint ATS',
    description:
      'A Dhaka/Atlanta software firm recruiting through the Pinpoint ATS, which exposes a public postings feed. We read title, location, salary (when the employer makes it visible), and the full description in one request.',
  },
  bdtask: {
    label: 'Bdtask',
    initials: 'BT',
    color: '#F5A623',
    method: 'HTML parsing',
    description:
      'A Bangladesh software product company. Its careers page is plain server-rendered HTML with no API, so we parse the job list and fetch each detail page for the location and description.',
  },
  selise: {
    label: 'SELISE Digital Platforms',
    initials: 'SE',
    color: '#E4002B',
    method: 'hirebee.ai ATS',
    description:
      'A Swiss-Bangladeshi engineering company recruiting through the hirebee.ai ATS. The listings are server-rendered HTML, so we scrape the job list (title and city) and each detail page for the full description.',
  },
  bjit: {
    label: 'BJIT Limited',
    initials: 'BJ',
    color: '#0057B8',
    method: 'JSON API',
    description:
      'A Bangladesh-Japan software firm. Its Next.js career page loads jobs from a public JSON API that already includes the full requirements, posting date, and country.',
  },
  cefalo: {
    label: 'Cefalo Bangladesh',
    initials: 'CE',
    color: '#5B2A86',
    method: 'Custom ATS',
    description:
      'A Norwegian-Bangladeshi software company running its own ATS. We read the public jobs endpoint, skip expired postings, and fetch each job for its full description and posting date.',
  },
  vivasoft: {
    label: 'Vivasoft Limited',
    initials: 'VS',
    color: '#FF6B35',
    method: 'Novara ATS',
    description:
      'A Bangladesh software outsourcing firm recruiting through the Novara ATS. We pull the public jobs API — title, city/country, salary when set — and fetch each job for the full HTML description and posting date.',
  },
  dsinnovators: {
    label: 'Dynamic Solution Innovators',
    initials: 'DS',
    color: '#2E8B57',
    method: 'hrythmic ATS',
    description:
      'A Dhaka software company recruiting through the hrythmic ATS. The openings page is server-rendered HTML, so we scrape the job list and each detail page for the description and posting date.',
  },
  'teletalk-govt': {
    label: 'alljobs.teletalk.com.bd',
    initials: 'TG',
    color: '#0A7D3B',
    method: 'Official portal',
    description:
      "Bangladesh government job circulars, pulled from the official portal's org-list and per-posting detail endpoints. These carry fields the general boards don't: vacancy count, age limits, gender requirement, publication and deadline dates, and a link to the official advertisement PDF.",
    isGovt: true,
  },
}

// Sources grouped by what they actually are, so the page reads as a map of the
// pipeline's reach rather than one long undifferentiated grid. The government
// portal is handled on its own below (it's scored differently), so it's not here.
const SOURCE_GROUPS: Array<{ title: string; blurb: string; sourceIds: JobSourceId[] }> = [
  {
    title: 'Global remote boards',
    blurb: 'Open APIs and feeds covering remote-first roles worldwide.',
    sourceIds: ['remoteok', 'weworkremotely', 'himalayas', 'adzuna'],
  },
  {
    title: 'Bangladesh engineering firms',
    blurb: 'Company career systems pulled directly — one integration per ATS.',
    sourceIds: [
      'brainstation-23',
      'riseup-labs',
      'enosis',
      'bdtask',
      'selise',
      'bjit',
      'cefalo',
      'vivasoft',
      'dsinnovators',
    ],
  },
]

type CountById = Map<JobSourceId, number>

function roleCountLabel(count: number): string {
  if (count <= 0) return 'No current roles'
  return `${count.toLocaleString()} open ${count === 1 ? 'role' : 'roles'}`
}

// Each source links to its own slice of the live feed — the page's primary action
// is "show me the jobs from this source."
function sourceHref(id: JobSourceId): string {
  return id === 'teletalk-govt' ? '/jobs?category=government' : `/jobs?sourceId=${id}`
}

function SourceCard({ source, href, count }: { source: SourceInfo; href: string; count: number }) {
  return (
    <Link
      to={href}
      className="reveal-card group flex h-full flex-col rounded-[var(--card-radius-md)] border border-border bg-card p-5 transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-[color:var(--line-strong)] hover:shadow-[var(--shadow-card)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--bg)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className="flex size-9 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold tracking-tight text-white"
            style={{ background: source.color }}
          >
            {source.initials}
          </span>
          <div className="min-w-0">
            <div className="src-name truncate text-[15px] leading-tight text-foreground">{source.label}</div>
            <div className="mono mt-0.5 text-[11px] text-muted-foreground">{source.method}</div>
          </div>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[11px] font-medium text-muted-foreground">
          <span className="size-1.5 rounded-full bg-[color:var(--cyan)]" aria-hidden="true" />
          Live
        </span>
      </div>
      <p className="mt-3.5 flex-1 text-[13px] leading-relaxed text-[color:var(--fg-2)]">{source.description}</p>
      <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
        <span className="mono text-[12px] text-muted-foreground">{roleCountLabel(count)}</span>
        <span className="text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true">
          <Icon name="arrow-forward-outline" style={{ fontSize: 14 }} />
        </span>
      </div>
    </Link>
  )
}

// Apple-style centered section head: large heading, a single supporting line,
// plenty of air. No metadata chrome — the whitespace does the work.
function SectionHead({ title, blurb }: { title: string; blurb: string }) {
  return (
    <div className="section-head center mx-auto">
      <h2>{title}</h2>
      <p>{blurb}</p>
    </div>
  )
}

function SourceGroup({
  title,
  blurb,
  sourceIds,
  countById,
}: {
  title: string
  blurb: string
  sourceIds: JobSourceId[]
  countById: CountById
}) {
  const gridRef = useScrollReveal<HTMLDivElement>({ selector: '.reveal-card' })
  return (
    <>
      <SectionHead title={title} blurb={blurb} />
      <div ref={gridRef} className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {sourceIds.map((id) => (
          <SourceCard key={id} source={SOURCES[id]} href={sourceHref(id)} count={countById.get(id) ?? 0} />
        ))}
      </div>
    </>
  )
}

// Shimmer rows shown while the coverage summary is loading, so the data area has
// shape instead of popping in from empty.
function CoverageSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-hidden="true">
      {Array.from({ length: 7 }).map((_, i) => (
        <div
          key={i}
          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 sm:grid-cols-[minmax(130px,190px)_1fr_auto]"
        >
          <span className="sk" style={{ width: '70%' }} />
          <span className="sk col-span-2 sm:col-span-1" style={{ height: 8, borderRadius: 999 }} />
          <span className="sk" style={{ width: 36 }} />
        </div>
      ))}
    </div>
  )
}

export function SourcesPage() {
  const [summary, setSummary] = useState<PublicJobsSummary | null>(null)

  useEffect(() => {
    apiFetch('/public/jobs-summary')
      .then((res) => (res.ok ? (res.json() as Promise<PublicJobsSummary>) : null))
      .then(setSummary)
      .catch(() => setSummary(null))
  }, [])

  const coverageRevealRef = useScrollReveal<HTMLDivElement>({ selector: '.reveal-cov-row' })

  const bySource = summary?.bySource ?? []
  const countById: CountById = new Map(bySource.map((entry) => [entry.sourceId, entry.count]))
  const maxCount = bySource.reduce((max, entry) => Math.max(max, entry.count), 0)
  const rankedCoverage = [...bySource].sort((a, b) => b.count - a.count)

  const govt = SOURCES['teletalk-govt']
  const govtCount = countById.get('teletalk-govt') ?? 0
  const totalSources = Object.keys(SOURCES).length

  // Count up the headline total once the summary lands; `null` keeps it at 0 until then.
  const animatedTotal = useCountUp(summary ? summary.totalJobs : null)

  const statNumberClass =
    'mt-1.5 font-[family-name:var(--font-heading)] text-[34px] font-bold leading-none tracking-tight text-foreground'

  return (
    <div className="apple-ui">
      <PublicNav />

      <section className="page-head">
        <div className="wrap">
          <div className="mx-auto max-w-3xl text-center">
            <div className="kicker justify-center">Sources</div>
            <h1>Where every job comes from.</h1>
            <p className="subtitle mx-auto">
              Every source below is live — nothing here is aspirational. Each feeds the same
              discover-then-verify pipeline before a listing is ever scored.
            </p>

            <div className="mt-8 flex justify-center">
              <Link to="/jobs" className="apple-pill">
                Browse all jobs
                <Icon name="chevron-forward-outline" style={{ fontSize: 15 }} />
              </Link>
            </div>

            <dl className="mt-12 flex flex-wrap justify-center gap-x-12 gap-y-6">
              <div>
                <dt className="mono text-[11px] uppercase tracking-[0.1em] text-muted-foreground">Jobs indexed</dt>
                <dd className={statNumberClass}>
                  {summary ? (
                    animatedTotal.toLocaleString()
                  ) : (
                    <span className="sk inline-block align-middle" style={{ width: 96, height: 30 }} />
                  )}
                </dd>
              </div>
              <div className="border-l border-border pl-12">
                <dt className="mono text-[11px] uppercase tracking-[0.1em] text-muted-foreground">Live sources</dt>
                <dd className={statNumberClass}>{totalSources}</dd>
              </div>
              <div className="border-l border-border pl-12">
                <dt className="mono text-[11px] uppercase tracking-[0.1em] text-muted-foreground">Govt circulars</dt>
                <dd className={statNumberClass}>
                  {summary ? (
                    govtCount.toLocaleString()
                  ) : (
                    <span className="sk inline-block align-middle" style={{ width: 48, height: 30 }} />
                  )}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      {/* Alternating full-bleed bands (white ↔ #F5F5F7), Apple product-page style. */}
      {SOURCE_GROUPS.map((group, i) => (
        <section key={group.title} className={`band${i % 2 === 0 ? ' band-alt' : ''}`}>
          <div className="wrap">
            <SourceGroup {...group} countById={countById} />
          </div>
        </section>
      ))}

      {/* Government: its own band, pairing the source with why it's scored
          differently — a distinct panel, not just another card. */}
      <section className="band band-alt">
        <div className="wrap">
          <SectionHead
            title="Government circulars"
            blurb="Discovered like any source, but deliberately kept out of the score."
          />
          <div className="mx-auto grid max-w-5xl overflow-hidden rounded-[var(--card-radius-lg)] border border-border bg-card md:grid-cols-[minmax(0,340px)_1fr]">
            <Link
              to={sourceHref('teletalk-govt')}
              className="group block border-b border-border p-6 transition-colors duration-200 hover:bg-[color:var(--indigo-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--ring)] md:border-b-0 md:border-r"
            >
              <div className="flex items-center gap-3">
                <span
                  className="flex size-9 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold tracking-tight text-white"
                  style={{ background: govt.color }}
                >
                  {govt.initials}
                </span>
                <div className="min-w-0">
                  <div className="src-name truncate text-[15px] leading-tight text-foreground">{govt.label}</div>
                  <div className="mono mt-0.5 text-[11px] text-muted-foreground">{govt.method}</div>
                </div>
              </div>
              <p className="mt-3.5 text-[13px] leading-relaxed text-[color:var(--fg-2)]">{govt.description}</p>
              <div className="mt-4 flex items-center gap-3 border-t border-border pt-3">
                <Pill tone="govt">Government</Pill>
                <span className="mono text-[12px] text-muted-foreground">{roleCountLabel(govtCount)}</span>
                <span className="ml-auto text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true">
                  <Icon name="arrow-forward-outline" style={{ fontSize: 14 }} />
                </span>
              </div>
            </Link>

            <div className="p-6 md:p-8">
              <div className="kicker">Why it skips scoring</div>
              <h3 className="text-[22px] leading-snug text-foreground">
                The 0–100 match score wouldn't mean anything here.
              </h3>
              <p className="subtitle mt-3 text-[15px] leading-relaxed text-[color:var(--fg-2)]">
                That score is built from five factors — work authorization, remote fit, salary,
                skills, and location — which assume a conventional listing with a salary range and a
                remote-work policy. Government circulars don't map onto that shape, so postings from
                alljobs.teletalk.com.bd are discovered like any other source but skip the
                verification and scoring stages entirely, rather than being forced through a formula
                that wouldn't mean anything for them.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="band">
        <div className="wrap">
          <SectionHead
            title="Current coverage"
            blurb="Live listing counts per source, from the most recent discovery run."
          />

          <div className="mx-auto max-w-3xl">
            {summary === null ? (
              <CoverageSkeleton />
            ) : rankedCoverage.length === 0 ? (
              <div className="rounded-[var(--card-radius-md)] border border-dashed border-border px-6 py-12 text-center">
                <p className="src-name text-[15px] text-foreground">No listings indexed yet</p>
                <p className="subtitle mx-auto mt-1.5 max-w-sm text-[13.5px] text-muted-foreground">
                  Coverage appears here after the next discovery run pulls jobs from the sources above.
                </p>
              </div>
            ) : (
              <div ref={coverageRevealRef} className="flex flex-col gap-3">
                {rankedCoverage.map((entry) => {
                  const source = SOURCES[entry.sourceId]
                  const pct = maxCount > 0 ? (entry.count / maxCount) * 100 : 0
                  return (
                    <div
                      key={entry.sourceId}
                      className="reveal-cov-row grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 sm:grid-cols-[minmax(130px,190px)_1fr_auto]"
                    >
                      <span className="truncate text-[13px] text-foreground">{source.label}</span>
                      <span className="col-span-2 order-last h-2 overflow-hidden rounded-full bg-[color:var(--ring-track)] sm:order-none sm:col-span-1">
                        <span
                          className="block h-full rounded-full"
                          style={{ width: `${pct}%`, background: source.color }}
                        />
                      </span>
                      <span className="mono w-14 text-right text-[12.5px] tabular-nums text-muted-foreground">
                        {entry.count.toLocaleString()}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </section>

      <Footer />
    </div>
  )
}
