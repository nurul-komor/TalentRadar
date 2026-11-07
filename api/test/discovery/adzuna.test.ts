import { describe, it, expect, vi, afterEach } from 'vitest'
import { createAdzunaSource } from '../../src/discovery/sources/adzuna'

const ENV = { ADZUNA_APP_ID: 'id', ADZUNA_APP_KEY: 'key', ADZUNA_COUNTRY: 'ae' }

function result(overrides: {
  id: number | string
  title: string
  company?: string
  location?: string
  salary_min?: number | null
  salary_max?: number | null
  created?: string
  description?: string
}) {
  return {
    id: overrides.id,
    title: overrides.title,
    description: overrides.description ?? 'A role',
    redirect_url: `https://www.adzuna.ae/land/ad/${overrides.id}`,
    created: overrides.created ?? '2026-11-01T00:00:00Z',
    salary_min: overrides.salary_min ?? null,
    salary_max: overrides.salary_max ?? null,
    company: { display_name: overrides.company ?? 'Acme' },
    location: { display_name: overrides.location ?? 'Dubai' },
  }
}

function stubResults(results: unknown[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ results }), { status: 200 }))
  )
}

describe('createAdzunaSource', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('maps a matching result to a RawJobPosting', async () => {
    stubResults([
      result({ id: 42, title: 'Senior PHP Developer', company: 'Noon', location: 'Dubai', salary_min: 15000, salary_max: 25000 }),
    ])

    const jobs = await createAdzunaSource(ENV).fetchJobs()

    expect(jobs).toContainEqual({
      sourceId: 'adzuna',
      sourceJobId: '42',
      url: 'https://www.adzuna.ae/land/ad/42',
      title: 'Senior PHP Developer',
      company: 'Noon',
      rawDescription: 'A role',
      location: 'Dubai',
      salaryMin: 15000,
      salaryMax: 25000,
      postedAt: '2026-11-01T00:00:00Z',
    })
  })

  it('drops results whose title does not match a tracked keyword', async () => {
    stubResults([
      result({ id: 1, title: 'Software Engineer' }),
      result({ id: 2, title: 'IT Support Technician' }),
    ])

    const jobs = await createAdzunaSource(ENV).fetchJobs()

    expect(jobs.map((j) => j.title)).toContain('Software Engineer')
    expect(jobs.map((j) => j.title)).not.toContain('IT Support Technician')
  })

  it('de-dupes a result surfaced by multiple search terms', async () => {
    stubResults([result({ id: 7, title: 'Full Stack Developer' })])

    const jobs = await createAdzunaSource(ENV).fetchJobs()

    expect(jobs.filter((j) => j.sourceJobId === '7')).toHaveLength(1)
  })

  it('returns [] and makes no request when credentials are missing', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const jobs = await createAdzunaSource({ ADZUNA_APP_ID: '', ADZUNA_APP_KEY: '' }).fetchJobs()

    expect(jobs).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('skips a term on a non-ok response without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('rate limited', { status: 429 })))

    await expect(createAdzunaSource(ENV).fetchJobs()).resolves.toEqual([])
  })
})
