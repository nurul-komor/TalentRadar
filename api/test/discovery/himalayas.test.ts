import { describe, it, expect, vi, afterEach } from 'vitest'
import { himalayasSource } from '../../src/discovery/sources/himalayas'

describe('himalayasSource', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('parses jobs and converts the Unix pubDate to an ISO string', async () => {
    const fixture = {
      totalCount: 1,
      nextCursor: 'abc',
      jobs: [
        {
          title: 'Senior Regulatory Affairs Associate',
          companyName: 'Parexel',
          description: '<p>Role description</p>',
          locationRestrictions: ['Serbia'],
          minSalary: null,
          maxSalary: null,
          pubDate: 1792594411,
          applicationLink:
            'https://himalayas.app/companies/parexel/jobs/senior-regulatory-affairs-associate?utm_source=api',
          guid: 'https://himalayas.app/companies/parexel/jobs/senior-regulatory-affairs-associate',
        },
      ],
    }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(fixture), { status: 200 }))
    )

    const jobs = await himalayasSource.fetchJobs()

    expect(jobs).toEqual([
      {
        sourceId: 'himalayas',
        sourceJobId: 'https://himalayas.app/companies/parexel/jobs/senior-regulatory-affairs-associate',
        url: 'https://himalayas.app/companies/parexel/jobs/senior-regulatory-affairs-associate',
        title: 'Senior Regulatory Affairs Associate',
        company: 'Parexel',
        rawDescription: '<p>Role description</p>',
        location: 'Serbia',
        salaryMin: null,
        salaryMax: null,
        postedAt: new Date(1792594411 * 1000).toISOString(),
      },
    ])
  })

  it('throws when the response status is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })))

    await expect(himalayasSource.fetchJobs()).rejects.toThrow('503')
  })
})
