import { describe, it, expect, vi, afterEach } from 'vitest'
import { enosisSource } from '../../src/discovery/sources/enosis'

describe('enosisSource', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('maps Pinpoint postings, builds location, and reads visible compensation', async () => {
    const fixture = {
      data: [
        {
          id: '559663',
          title: 'Senior Software Engineer',
          url: 'https://careers.enosisbd.com/en/postings/ce6c9e5c',
          path: '/en/postings/ce6c9e5c',
          description: '<div>About the role</div>',
          key_responsibilities: '<div>Responsibilities</div>',
          skills_knowledge_expertise: '<div>Skills</div>',
          benefits: '<div>Benefits</div>',
          workplace_type_text: 'Fully remote',
          compensation_visible: true,
          compensation_minimum: 50000,
          compensation_maximum: 70000,
          location: { city: 'Dhaka', province: 'Dhaka', name: 'Remote' },
        },
      ],
    }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(fixture), { status: 200 }))
    )

    const jobs = await enosisSource.fetchJobs()

    expect(jobs).toEqual([
      {
        sourceId: 'enosis',
        sourceJobId: '559663',
        url: 'https://careers.enosisbd.com/en/postings/ce6c9e5c',
        title: 'Senior Software Engineer',
        company: 'Enosis Solutions',
        rawDescription:
          '<div>About the role</div>\n<div>Responsibilities</div>\n<div>Skills</div>\n<div>Benefits</div>',
        location: 'Dhaka, Remote (Fully remote)',
        salaryMin: 50000,
        salaryMax: 70000,
        postedAt: null,
      },
    ])
  })

  it('ignores compensation when it is not marked visible', async () => {
    const fixture = {
      data: [
        {
          id: 1,
          title: 'QA Engineer',
          url: 'https://careers.enosisbd.com/en/postings/abc',
          description: '<p>desc</p>',
          compensation_visible: false,
          compensation_minimum: 1000,
          compensation_maximum: 2000,
          location: { name: 'Dhaka' },
        },
      ],
    }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(fixture), { status: 200 }))
    )

    const [job] = await enosisSource.fetchJobs()

    expect(job.salaryMin).toBeNull()
    expect(job.salaryMax).toBeNull()
    expect(job.location).toBe('Dhaka')
  })

  it('returns an empty list when there are no open postings', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }))
    )

    await expect(enosisSource.fetchJobs()).resolves.toEqual([])
  })

  it('throws when the response status is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 502 })))

    await expect(enosisSource.fetchJobs()).rejects.toThrow('502')
  })
})
