import { describe, it, expect, vi, afterEach } from 'vitest'
import { riseupLabsSource } from '../../src/discovery/sources/riseupLabs'

const CAREERS_HTML = `
<section>
  <h2>Currently Open Positions</h2>
  <a href="https://riseuplabs.com/jobs/data-driven-qa-automation-engineer/">QA Engineer</a>
  <a href="https://riseuplabs.com/jobs/data-driven-qa-automation-engineer/">QA Engineer (dup)</a>
  <a href="https://riseuplabs.com/jobs/">All Jobs</a>
</section>`

const WP_JOB = [
  {
    slug: 'data-driven-qa-automation-engineer',
    link: 'https://riseuplabs.com/jobs/data-driven-qa-automation-engineer/',
    date_gmt: '2026-11-02T09:30:47',
    title: { rendered: 'Data Driven QA &#038; Automation Engineer' },
    content: { rendered: '<section>Job body</section>' },
  },
]

describe('riseupLabsSource', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('scrapes open-position slugs and enriches each from the WP API by slug', async () => {
    const fetchMock = vi.fn((input: string) => {
      const url = String(input)
      const body = url.includes('/wp-json/') ? JSON.stringify(WP_JOB) : CAREERS_HTML
      return Promise.resolve(new Response(body, { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const jobs = await riseupLabsSource.fetchJobs()

    expect(jobs).toEqual([
      {
        sourceId: 'riseup-labs',
        sourceJobId: 'data-driven-qa-automation-engineer',
        url: 'https://riseuplabs.com/jobs/data-driven-qa-automation-engineer/',
        title: 'Data Driven QA & Automation Engineer',
        company: 'Riseup Labs',
        rawDescription: '<section>Job body</section>',
        location: null,
        salaryMin: null,
        salaryMax: null,
        postedAt: new Date('2026-11-02T09:30:47Z').toISOString(),
      },
    ])
  })

  it('skips a slug whose WP lookup returns nothing, without failing the batch', async () => {
    const fetchMock = vi.fn((input: string) => {
      const url = String(input)
      if (url.includes('/wp-json/')) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      }
      return Promise.resolve(new Response(CAREERS_HTML, { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(riseupLabsSource.fetchJobs()).resolves.toEqual([])
  })

  it('throws when the careers page status is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 500 })))

    await expect(riseupLabsSource.fetchJobs()).rejects.toThrow('500')
  })
})
