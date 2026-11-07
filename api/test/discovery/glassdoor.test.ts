import { describe, it, expect, vi, afterEach } from 'vitest'
import { glassdoorSource } from '../../src/discovery/sources/glassdoor'

function graphResponse(listings: unknown[]): Response {
  return new Response(JSON.stringify([{ data: { jobListings: { jobListings: listings } } }]), {
    status: 200,
  })
}

function listing(overrides: {
  listingId: number | string
  title: string
  company?: string
  location?: string
  p10?: number | null
  p90?: number | null
  ageInDays?: number
  description?: string
}) {
  return {
    jobview: {
      header: {
        jobTitleText: overrides.title,
        employerNameFromSearch: overrides.company ?? 'Acme',
        locationName: overrides.location ?? 'Remote',
        ageInDays: overrides.ageInDays ?? 2,
        payPeriodAdjustedPay: { p10: overrides.p10 ?? null, p90: overrides.p90 ?? null },
      },
      job: {
        listingId: overrides.listingId,
        jobTitleText: overrides.title,
        descriptionFragmentText: overrides.description ?? 'A role',
        jobLink: `/job-listing/x-${overrides.listingId}`,
      },
    },
  }
}

// Stub fetch: the CSRF seed page (a .htm GET) returns HTML with a token; every
// /graph POST returns the provided listings.
function stubFetch(token: string | null, listings: unknown[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('.htm')) {
        const html = token ? `<script>{"token":"${token}"}</script>` : '<html>blocked</html>'
        return new Response(html, { status: token ? 200 : 403 })
      }
      return graphResponse(listings)
    })
  )
}

describe('glassdoorSource', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('maps matching listings and derives postedAt from ageInDays', async () => {
    stubFetch('abc:def', [
      listing({ listingId: 101, title: 'Senior PHP Developer', company: 'Acme', location: 'Dhaka', p10: 40000, p90: 80000, ageInDays: 3 }),
    ])

    const jobs = await glassdoorSource.fetchJobs()

    const posting = jobs.find((j) => j.sourceJobId === '101')
    expect(posting).toMatchObject({
      sourceId: 'glassdoor',
      sourceJobId: '101',
      url: 'https://www.glassdoor.com/job-listing/x-101',
      title: 'Senior PHP Developer',
      company: 'Acme',
      rawDescription: 'A role',
      location: 'Dhaka',
      salaryMin: 40000,
      salaryMax: 80000,
    })
    // postedAt is now - 3 days; assert it lands within a minute of expected.
    const expectedMs = Date.now() - 3 * 24 * 60 * 60 * 1000
    expect(Math.abs(new Date(posting!.postedAt!).getTime() - expectedMs)).toBeLessThan(60_000)
  })

  it('drops listings whose title does not match any tracked keyword', async () => {
    stubFetch('abc:def', [
      listing({ listingId: 1, title: 'Backend Engineer' }),
      listing({ listingId: 2, title: 'Marketing Manager' }),
    ])

    const jobs = await glassdoorSource.fetchJobs()

    expect(jobs.map((j) => j.title)).toContain('Backend Engineer')
    expect(jobs.map((j) => j.title)).not.toContain('Marketing Manager')
  })

  it('de-dupes the same listing surfaced by multiple search terms', async () => {
    // Every /graph call returns the same listing; it must appear once.
    stubFetch('abc:def', [listing({ listingId: 55, title: 'Software Engineer' })])

    const jobs = await glassdoorSource.fetchJobs()

    expect(jobs.filter((j) => j.sourceJobId === '55')).toHaveLength(1)
  })

  it('returns [] without throwing when Glassdoor blocks the CSRF page', async () => {
    stubFetch(null, [])

    await expect(glassdoorSource.fetchJobs()).resolves.toEqual([])
  })
})
