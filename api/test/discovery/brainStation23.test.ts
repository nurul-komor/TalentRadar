import { describe, it, expect, vi, afterEach } from 'vitest'
import { brainStation23Source } from '../../src/discovery/sources/brainStation23'

const HOME_FIXTURE = {
  status: 'SUCCESS',
  data: {
    jobs: [
      {
        id: 22930,
        title: 'Asp.Net Developer',
        slug: 'oqwvmsgpnk-aspnet-developer',
        job_type: 'on-site',
        meta: { is_remote: 0 },
        address: { city: null, state: { name: 'Dhaka' }, country: { name: 'Bangladesh' } },
      },
    ],
  },
}

const DETAIL_FIXTURE = {
  status: 'SUCCESS',
  data: {
    post: {
      requirements: '<p>Requirements</p>',
      responsibilies: '<p>Responsibilities</p>',
      benefits: '<p>Benefits</p>',
      salary: null,
    },
    address: { city: null, state: { name: 'Dhaka' }, country: { name: 'Bangladesh' } },
  },
}

describe('brainStation23Source', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists jobs and enriches each with its detail description', async () => {
    const fetchMock = vi.fn((input: string) => {
      const url = String(input)
      const body = url.includes('/api/career/job/') ? DETAIL_FIXTURE : HOME_FIXTURE
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const jobs = await brainStation23Source.fetchJobs()

    expect(jobs).toEqual([
      {
        sourceId: 'brainstation-23',
        sourceJobId: 'oqwvmsgpnk-aspnet-developer',
        url: 'https://brainstation-23.easy.jobs/oqwvmsgpnk-aspnet-developer',
        title: 'Asp.Net Developer',
        company: 'Brain Station 23',
        rawDescription: '<p>Responsibilities</p>\n<p>Requirements</p>\n<p>Benefits</p>',
        location: 'Dhaka, Bangladesh',
        salaryMin: null,
        salaryMax: null,
        postedAt: null,
      },
    ])
  })

  it('still records a posting from list data when the detail request fails', async () => {
    const fetchMock = vi.fn((input: string) => {
      const url = String(input)
      if (url.includes('/api/career/job/')) {
        return Promise.resolve(new Response('', { status: 500 }))
      }
      return Promise.resolve(new Response(JSON.stringify(HOME_FIXTURE), { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const jobs = await brainStation23Source.fetchJobs()

    expect(jobs).toHaveLength(1)
    expect(jobs[0]).toMatchObject({
      sourceId: 'brainstation-23',
      company: 'Brain Station 23',
      rawDescription: '',
      location: 'Dhaka, Bangladesh',
    })
  })

  it('throws when the home listing status is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })))

    await expect(brainStation23Source.fetchJobs()).rejects.toThrow('503')
  })
})
