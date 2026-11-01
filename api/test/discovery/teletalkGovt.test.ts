import { describe, it, expect, vi, afterEach } from 'vitest'
import { teletalkGovtSource } from '../../src/discovery/sources/teletalkGovt'

function orgListPage(opts: { count: number; orgs: Array<Record<string, unknown>> }) {
  return new Response(JSON.stringify({ status: 'success', count: opts.count, govtOrgJobs: opts.orgs }), {
    status: 200,
  })
}

function publicDetails(details: Record<string, unknown>) {
  return new Response(JSON.stringify({ status: 'success', details }), { status: 200 })
}

const ORG = {
  id: 559,
  name: 'Narail Distric (DCNARAIL)',
  name_bn: null,
  website: 'http://narail.gov.bd/',
  job_created_at: '2026-10-29T08:59:28.379Z',
  govt_jobs: [{ id: 15068, job_title: 'Accounts Assistant', job_title_bn: 'হিসাব সহকারী', organization_id: 559 }],
}

const DETAILS = {
  id: 15068,
  job_title: 'Accounts Assistant',
  job_id: 'GJOB15068',
  vacancy: '02',
  gender: 3,
  min_age: 18,
  max_age: 32,
  application_site: 'https://dcnarail.teletalk.com.bd/',
  advertisement_file: 'public/uploads/governments/jobs/advertisement-1793262869609.pdf',
  published_date: '2026-11-01T03:00:00.000Z',
  deadline_date: '2026-11-22T10:00:00.000Z',
  advertisement_no: '05.44.6500.402.06.012.26-206',
}

describe('teletalkGovtSource', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('paginates the org-list and fetches full detail for every job stub', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('org-list')) return Promise.resolve(orgListPage({ count: 1, orgs: [ORG] }))
      if (url.includes('public-details')) return Promise.resolve(publicDetails(DETAILS))
      throw new Error(`unexpected url: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const jobs = await teletalkGovtSource.fetchJobs()

    expect(jobs).toEqual([
      {
        sourceId: 'teletalk-govt',
        sourceJobId: '15068',
        url: 'https://alljobs.teletalk.com.bd/jobs/government/559?jobId=15068',
        title: 'Accounts Assistant',
        company: 'Narail Distric (DCNARAIL)',
        rawDescription:
          'Accounts Assistant at Narail Distric (DCNARAIL) — 02 vacancies. Published 2026-11-01T03:00:00.000Z, deadline 2026-11-22T10:00:00.000Z.',
        location: null,
        salaryMin: null,
        salaryMax: null,
        postedAt: '2026-11-01T03:00:00.000Z',
        govtDetails: {
          jobCode: 'GJOB15068',
          vacancy: '02',
          minAge: 18,
          maxAge: 32,
          genderRequirement: 'any',
          publishedDate: '2026-11-01T03:00:00.000Z',
          deadlineDate: '2026-11-22T10:00:00.000Z',
          advertisementNo: '05.44.6500.402.06.012.26-206',
          advertisementPdfUrl:
            'https://alljobs.teletalk.com.bd/public/uploads/governments/jobs/advertisement-1793262869609.pdf',
          applicationPortalUrl: 'https://dcnarail.teletalk.com.bd/',
        },
      },
    ])
  })

  it('walks every page until the org-list count is exhausted', async () => {
    const orgPage1 = { ...ORG, id: 1, govt_jobs: [{ id: 101, job_title: 'A', job_title_bn: 'ক', organization_id: 1 }] }
    const orgPage2 = { ...ORG, id: 2, govt_jobs: [{ id: 102, job_title: 'B', job_title_bn: 'খ', organization_id: 2 }] }
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('page=1')) return Promise.resolve(orgListPage({ count: 2, orgs: [orgPage1] }))
      if (url.includes('page=2')) return Promise.resolve(orgListPage({ count: 2, orgs: [orgPage2] }))
      if (url.includes('id=101')) return Promise.resolve(publicDetails({ ...DETAILS, id: 101, job_id: 'GJOB101' }))
      if (url.includes('id=102')) return Promise.resolve(publicDetails({ ...DETAILS, id: 102, job_id: 'GJOB102' }))
      throw new Error(`unexpected url: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const jobs = await teletalkGovtSource.fetchJobs()

    expect(jobs.map((j) => j.sourceJobId)).toEqual(['101', '102'])
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('page=1'))).toBe(true)
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('page=2'))).toBe(true)
  })

  it('skips a single posting whose public-details call returns an error, without failing the batch', async () => {
    const orgWithTwoJobs = {
      ...ORG,
      govt_jobs: [
        { id: 15068, job_title: 'Accounts Assistant', job_title_bn: 'হিসাব সহকারী', organization_id: 559 },
        { id: 99999999, job_title: 'Broken Posting', job_title_bn: 'X', organization_id: 559 },
      ],
    }
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('org-list')) return Promise.resolve(orgListPage({ count: 1, orgs: [orgWithTwoJobs] }))
      if (url.includes('id=15068')) return Promise.resolve(publicDetails(DETAILS))
      if (url.includes('id=99999999')) {
        return Promise.resolve(
          new Response(JSON.stringify({ status: 'error', statusCode: 400, message: {} }), { status: 400 })
        )
      }
      throw new Error(`unexpected url: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const jobs = await teletalkGovtSource.fetchJobs()

    expect(jobs).toHaveLength(1)
    expect(jobs[0].sourceJobId).toBe('15068')
  })

  it('maps an unrecognized gender code to unknown', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('org-list')) return Promise.resolve(orgListPage({ count: 1, orgs: [ORG] }))
      if (url.includes('public-details')) return Promise.resolve(publicDetails({ ...DETAILS, gender: 7 }))
      throw new Error(`unexpected url: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const jobs = await teletalkGovtSource.fetchJobs()

    expect(jobs[0].govtDetails?.genderRequirement).toBe('unknown')
  })

  it('stops paginating once a page returns no orgs, even if count claims more pages', async () => {
    const orgPage1 = {
      ...ORG,
      id: 1,
      govt_jobs: [{ id: 201, job_title: 'A', job_title_bn: 'ক', organization_id: 1 }],
    }
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('page=1')) return Promise.resolve(orgListPage({ count: 5, orgs: [orgPage1] }))
      if (url.includes('page=2')) return Promise.resolve(orgListPage({ count: 5, orgs: [] }))
      if (url.includes('id=201')) return Promise.resolve(publicDetails({ ...DETAILS, id: 201, job_id: 'GJOB201' }))
      throw new Error(`unexpected url: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const jobs = await teletalkGovtSource.fetchJobs()

    expect(jobs.map((j) => j.sourceJobId)).toEqual(['201'])
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('page=3'))).toBe(false)
  })

  it('throws when the org-list page itself fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })))

    await expect(teletalkGovtSource.fetchJobs()).rejects.toThrow('503')
  })
})
