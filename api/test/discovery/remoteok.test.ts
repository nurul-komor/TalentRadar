import { describe, it, expect, vi, afterEach } from 'vitest'
import { remoteOkSource } from '../../src/discovery/sources/remoteok'

describe('remoteOkSource', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('parses job listings and skips the leading legal blob', async () => {
    const fixture = [
      { legal: 'https://remoteok.com/terms' },
      {
        id: '12345',
        company: 'Acme Corp',
        position: 'Senior Backend Engineer',
        description: '<p>We are hiring a backend engineer.</p>',
        location: 'Worldwide',
        url: 'https://remoteok.com/remote-jobs/12345-senior-backend-engineer-acme-corp',
        date: '2026-10-01T00:00:00+00:00',
        salary_min: 90000,
        salary_max: 130000,
      },
    ]
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(fixture), { status: 200 }))
    )

    const jobs = await remoteOkSource.fetchJobs()

    expect(jobs).toEqual([
      {
        sourceId: 'remoteok',
        sourceJobId: '12345',
        url: 'https://remoteok.com/remote-jobs/12345-senior-backend-engineer-acme-corp',
        title: 'Senior Backend Engineer',
        company: 'Acme Corp',
        rawDescription: '<p>We are hiring a backend engineer.</p>',
        location: 'Worldwide',
        salaryMin: 90000,
        salaryMax: 130000,
        postedAt: '2026-10-01T00:00:00+00:00',
      },
    ])
  })

  it('throws when the response status is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })))

    await expect(remoteOkSource.fetchJobs()).rejects.toThrow('503')
  })
})
