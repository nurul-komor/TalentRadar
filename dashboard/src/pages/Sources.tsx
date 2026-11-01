import { useEffect, useState } from 'react'
import type { JobSourceId, PublicJobsSummary } from '@job-hunter/shared'
import { apiFetch } from '../api/client'
import { PublicNav } from '../components/Nav'
import { Footer } from '../components/Footer'
import { Pill } from '../components/Pill'
import { useScrollReveal } from '../hooks/useScrollReveal'

interface SourceInfo {
  label: string
  initials: string
  color: string
  description: string
  isGovt?: boolean
}

const SOURCES: Record<JobSourceId, SourceInfo> = {
  remoteok: {
    label: 'Remote OK',
    initials: 'OK',
    color: '#4453FF',
    description:
      "A general remote-jobs board. We pull their public job API directly — title, company, description, location, salary when it's listed, and posting date.",
  },
  weworkremotely: {
    label: 'We Work Remotely',
    initials: 'WWR',
    color: '#1FC9B7',
    description:
      'We parse the public RSS feed for their remote-programming-jobs category. Company and title come from a single listing field, split on the colon they always use between them.',
  },
  himalayas: {
    label: 'Himalayas',
    initials: 'HI',
    color: '#6B78FF',
    description:
      'Another general remote board, pulled from their public jobs API — the same shape as Remote OK: title, company, description, salary range, and location restrictions when the listing specifies them.',
  },
  'teletalk-govt': {
    label: 'alljobs.teletalk.com.bd',
    initials: 'TG',
    color: '#0A0F1E',
    description:
      "Bangladesh government job circulars, pulled from the official portal's org-list and per-posting detail endpoints. These carry fields the general boards don't: vacancy count, age limits, gender requirement, publication and deadline dates, and a link to the official advertisement PDF.",
    isGovt: true,
  },
}

const SOURCE_ORDER: JobSourceId[] = ['remoteok', 'weworkremotely', 'himalayas', 'teletalk-govt']

export function SourcesPage() {
  const [summary, setSummary] = useState<PublicJobsSummary | null>(null)

  useEffect(() => {
    apiFetch('/public/jobs-summary')
      .then((res) => (res.ok ? (res.json() as Promise<PublicJobsSummary>) : null))
      .then(setSummary)
      .catch(() => setSummary(null))
  }, [])

  const sourcesRevealRef = useScrollReveal<HTMLDivElement>({ selector: '.reveal-src-card' })
  const coverageRevealRef = useScrollReveal<HTMLDivElement>({ selector: '.reveal-cov-row' })

  const bySource = summary?.bySource ?? []
  const maxCount = bySource.reduce((max, entry) => Math.max(max, entry.count), 0)

  return (
    <div>
      <PublicNav />

      <section className="page-head">
        <div className="wrap">
          <div className="kicker">Sources</div>
          <h1>Where the jobs come from.</h1>
          <p>
            Every source below is live — nothing here is aspirational. Each one feeds the same
            discover-then-verify pipeline before any listing reaches a score.
          </p>
        </div>
      </section>

      <section className="band">
        <div className="wrap">
          <div ref={sourcesRevealRef} className="src-grid">
            {SOURCE_ORDER.map((sourceId) => {
              const source = SOURCES[sourceId]
              return (
                <div className="src-card reveal-src-card" key={sourceId}>
                  <div className="top">
                    <div className="name">
                      <span className="fav" style={{ background: source.color }}>
                        {source.initials}
                      </span>
                      {source.label}
                    </div>
                    <span className="status live">
                      <i />
                      Live
                    </span>
                  </div>
                  <p>{source.description}</p>
                  {source.isGovt && <Pill tone="govt">Government</Pill>}
                </div>
              )
            })}
          </div>

          <div className="section-head" style={{ marginTop: 72 }}>
            <div className="kicker">Why one source skips scoring</div>
            <h2>Government circulars aren't scored the same way.</h2>
            <p>
              The 0–100 match score is built from five factors — work authorization, remote fit,
              salary, skills, and location — that assume a conventional listing with a salary range
              and a remote-work policy. Government circulars don't map onto that shape, so postings
              from alljobs.teletalk.com.bd are discovered like any other source but skip the
              verification and scoring stages entirely, rather than being forced through a formula
              that wouldn't mean anything for them.
            </p>
          </div>

          {bySource.length > 0 && (
            <div className="coverage">
              <h2>Current coverage</h2>
              <div ref={coverageRevealRef} className="cov-rows">
                {bySource.map((entry) => (
                  <div className="cov-row reveal-cov-row" key={entry.sourceId}>
                    <span>{SOURCES[entry.sourceId].label}</span>
                    <span className="bar">
                      <i
                        style={{
                          width: maxCount > 0 ? `${(entry.count / maxCount) * 100}%` : '0%',
                        }}
                      />
                    </span>
                    <span className="n">{entry.count.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      <Footer />
    </div>
  )
}
