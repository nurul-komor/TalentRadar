import { describe, it, expect, vi, afterEach } from 'vitest'
import { dsInnovatorsSource } from '../../src/discovery/sources/dsInnovators'

const LISTING_HTML = `
<div class="flex flex-col gap-7">
  <a href="/recruit/openings/59d39902-5674-4170-8f02-121373379e35/">Project Coordinator</a>
  <a href="/recruit/openings/59d39902-5674-4170-8f02-121373379e35/">Project Coordinator</a>
</div>`

const DETAIL_HTML = `
<div class="flex flex-col gap-7">
  <div>Posted on 2 Nov 2026</div>
  <div>Deadline on 29 Nov 2026</div>
  <div>
    <div class="text-xl font-semibold text-slate-900">Description</div>
    <div class="mt-3.5 flex flex-col gap-5 text-lg"><p>We are hiring a coordinator.</p></div>
  </div>
</div>`

describe('dsInnovatorsSource', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('dedupes listing links and reads description + posted date from the detail page', async () => {
    const fetchMock = vi.fn((input: string) => {
      const url = String(input)
      // The listing URL ends with company/dsinnovators/; detail URLs end with the uuid/.
      const isDetail = /openings\/[0-9a-f-]{36}\/$/.test(url)
      return Promise.resolve(new Response(isDetail ? DETAIL_HTML : LISTING_HTML, { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const jobs = await dsInnovatorsSource.fetchJobs()

    expect(jobs).toEqual([
      {
        sourceId: 'dsinnovators',
        sourceJobId: '59d39902-5674-4170-8f02-121373379e35',
        url: 'https://app.hrythmic.com/recruit/openings/59d39902-5674-4170-8f02-121373379e35/',
        title: 'Project Coordinator',
        company: 'Dynamic Solution Innovators',
        rawDescription: '<p>We are hiring a coordinator.</p>',
        location: null,
        salaryMin: null,
        salaryMax: null,
        postedAt: '2026-11-02T00:00:00.000Z',
      },
    ])
  })

  it('throws when the listing status is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 500 })))

    await expect(dsInnovatorsSource.fetchJobs()).rejects.toThrow('500')
  })
})
