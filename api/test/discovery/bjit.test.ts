import { describe, it, expect, vi, afterEach } from 'vitest'
import { bjitSource } from '../../src/discovery/sources/bjit'

describe('bjitSource', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('maps jobs, builds a unique path URL, and combines description fields', async () => {
    const fixture = {
      success: true,
      results: {
        jobs: [
          {
            _id: '6ab3648fb48286306cf81bf7',
            position: 'Data Architect',
            country: 'Bangladesh',
            shortDescription: 'Summary line',
            requirements: '<p>Requirements</p>',
            createdAt: '2026-07-02T07:56:56.472Z',
          },
        ],
      },
    }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(fixture), { status: 200 }))
    )

    const jobs = await bjitSource.fetchJobs()

    expect(jobs).toEqual([
      {
        sourceId: 'bjit',
        sourceJobId: '6ab3648fb48286306cf81bf7',
        url: 'https://bjitgroup.com/career/6ab3648fb48286306cf81bf7',
        title: 'Data Architect',
        company: 'BJIT Limited',
        rawDescription: 'Summary line\n<p>Requirements</p>',
        location: 'Bangladesh',
        salaryMin: null,
        salaryMax: null,
        postedAt: '2026-07-02T07:56:56.472Z',
      },
    ])
  })

  it('throws when the response status is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 500 })))

    await expect(bjitSource.fetchJobs()).rejects.toThrow('500')
  })
})
