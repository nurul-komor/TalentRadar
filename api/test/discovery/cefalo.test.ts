import { describe, it, expect, vi, afterEach } from 'vitest'
import { cefaloSource } from '../../src/discovery/sources/cefalo'

const LIST = [
  { id: 1, title: 'Backend Engineer', summary: 'Summary', slug: 'backend-engineer-1', isExpired: false },
]

const DETAIL = {
  description: '<p>Full description</p>',
  summary: 'Summary',
  created_at: '2026-04-08T12:23:48.000Z',
}

describe('cefaloSource', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('surfaces listed jobs and enriches them from the detail endpoint', async () => {
    const fetchMock = vi.fn((input: string) => {
      const url = String(input)
      const body = url.includes('/public/job/') ? DETAIL : LIST
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const jobs = await cefaloSource.fetchJobs()

    expect(jobs).toEqual([
      {
        sourceId: 'cefalo',
        sourceJobId: 'backend-engineer-1',
        url: 'https://career.cefalo.com/job/backend-engineer-1',
        title: 'Backend Engineer',
        company: 'Cefalo Bangladesh',
        rawDescription: '<p>Full description</p>\nSummary',
        location: null,
        salaryMin: null,
        salaryMax: null,
        postedAt: '2026-04-08T12:23:48.000Z',
      },
    ])
  })

  it('throws when the listing status is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })))

    await expect(cefaloSource.fetchJobs()).rejects.toThrow('503')
  })
})
