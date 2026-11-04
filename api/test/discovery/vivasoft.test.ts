import { describe, it, expect, vi, afterEach } from 'vitest'
import { vivasoftSource } from '../../src/discovery/sources/vivasoft'

const LIST = {
  data: {
    items: [
      {
        id: 'e206b9b3',
        slug: 'senior-java-developer-874f18d8',
        title: 'JAVA Developer',
        description: 'Truncated plain text',
        city: 'Dhaka',
        country: 'Bangladesh',
        salary_min: null,
        salary_max: null,
      },
    ],
  },
}

const DETAIL = {
  data: {
    description: '<h4>Overview</h4><p>Full HTML</p>',
    posted_at: '2026-10-14T09:21:26.646385Z',
  },
}

describe('vivasoftSource', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('maps Novara jobs and prefers the detail HTML description and posted date', async () => {
    const fetchMock = vi.fn((input: string) => {
      const url = String(input)
      const body = url.includes('/jobs/slug/') ? DETAIL : LIST
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const jobs = await vivasoftSource.fetchJobs()

    expect(jobs).toEqual([
      {
        sourceId: 'vivasoft',
        sourceJobId: 'senior-java-developer-874f18d8',
        url: 'https://app.novara.com.my/jobs/senior-java-developer-874f18d8',
        title: 'JAVA Developer',
        company: 'Vivasoft Limited',
        rawDescription: '<h4>Overview</h4><p>Full HTML</p>',
        location: 'Dhaka, Bangladesh',
        salaryMin: null,
        salaryMax: null,
        postedAt: '2026-10-14T09:21:26.646385Z',
      },
    ])
  })

  it('falls back to the list description when the detail fetch fails', async () => {
    const fetchMock = vi.fn((input: string) => {
      const url = String(input)
      if (url.includes('/jobs/slug/')) {
        return Promise.resolve(new Response('', { status: 500 }))
      }
      return Promise.resolve(new Response(JSON.stringify(LIST), { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const [job] = await vivasoftSource.fetchJobs()

    expect(job.rawDescription).toBe('Truncated plain text')
    expect(job.postedAt).toBeNull()
  })

  it('throws when the listing status is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 502 })))

    await expect(vivasoftSource.fetchJobs()).rejects.toThrow('502')
  })
})
