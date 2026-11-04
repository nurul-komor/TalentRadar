import { describe, it, expect, vi, afterEach } from 'vitest'
import { seliseSource } from '../../src/discovery/sources/selise'

const LISTING_HTML = `
<div class="card-body">
  <div class="jobs-card">
    <div class="media-body">
      <h5><a class="job-title-bl" href="/en/jobs/senior-secops-engineer" data-pjax="0">Senior SecOps Engineer</a></h5>
      <p>SELISE Group</p>
    </div>
    <div class="last-job-box-date-loc">
      <p><span class="map-svg"><svg><path d="x"/></svg></span> Dhaka</p>
      <p>Full time</p>
    </div>
  </div>
</div>`

const DETAIL_HTML = `
<div class="sub-content">
  <div class="job-desc-box"><p>About the role</p></div>
  <div class="job-responsibilities-box"><ul><li>Do things</li></ul></div>
  <div class="job-qualifications-box"><ul><li>Skills</li></ul></div>
</div>`

describe('seliseSource', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('scrapes the listing (title + city) and the detail description', async () => {
    const fetchMock = vi.fn((input: string) => {
      const url = String(input)
      const body = url.includes('/en/jobs/') ? DETAIL_HTML : LISTING_HTML
      return Promise.resolve(new Response(body, { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const jobs = await seliseSource.fetchJobs()

    expect(jobs).toEqual([
      {
        sourceId: 'selise',
        sourceJobId: 'senior-secops-engineer',
        url: 'https://ats.hirebee.ai/en/jobs/senior-secops-engineer',
        title: 'Senior SecOps Engineer',
        company: 'SELISE Digital Platforms',
        rawDescription:
          '<p>About the role</p>\n<ul><li>Do things</li></ul>\n<ul><li>Skills</li></ul>',
        location: 'Dhaka',
        salaryMin: null,
        salaryMax: null,
        postedAt: null,
      },
    ])
  })

  it('throws when the listing status is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })))

    await expect(seliseSource.fetchJobs()).rejects.toThrow('503')
  })
})
