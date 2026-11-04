import { describe, it, expect, vi, afterEach } from 'vitest'
import { bdtaskSource } from '../../src/discovery/sources/bdtask'

const LISTING_HTML = `
<section>
  <div class="job_post">
    <h3 class="job-title m-0">Senior Software Engineer (Python/Django)</h3>
    <div class="job_content">
      <div class="job_exp"><p>Experience: <span class="pre">2 Years</span></p></div>
      <div class="job_details"><a href="career/sr-python-developer.php" class="btn-job">Job Details</a></div>
    </div>
  </div>
  <div class="job_post">
    <h3 class="job-title m-0">Sr. PHP Developer</h3>
    <div class="job_content">
      <div class="job_details"><a href="career/sr-php-developer.php" class="btn-job">Job Details</a></div>
    </div>
  </div>
</section>`

const DETAIL_HTML = `
<div class="details_content">
  <div class="job_details_content">
    <h3 class="mb-30">Job Context</h3>
    <p>We are hiring a backend engineer.</p>
    <div class="inner"><ul><li>Django</li></ul></div>
  </div>
  <div class="sidebar">
    <h3>Job Location</h3>
    <p>4th Floor, Mannan Plaza, Khilkhet, Dhaka-1229</p>
    <h3>Salary</h3>
    <p>Negotiable</p>
  </div>
</div>`

describe('bdtaskSource', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('scrapes the listing and enriches each job from its detail page', async () => {
    const fetchMock = vi.fn((input: string) => {
      const url = String(input)
      const body = url.endsWith('/career.php') ? LISTING_HTML : DETAIL_HTML
      return Promise.resolve(new Response(body, { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const jobs = await bdtaskSource.fetchJobs()

    expect(jobs).toHaveLength(2)
    expect(jobs[0]).toEqual({
      sourceId: 'bdtask',
      sourceJobId: 'sr-python-developer',
      url: 'https://www.bdtask.com/career/sr-python-developer.php',
      title: 'Senior Software Engineer (Python/Django)',
      company: 'Bdtask',
      rawDescription:
        '<h3 class="mb-30">Job Context</h3>\n    <p>We are hiring a backend engineer.</p>\n    <div class="inner"><ul><li>Django</li></ul></div>',
      location: '4th Floor, Mannan Plaza, Khilkhet, Dhaka-1229',
      salaryMin: null,
      salaryMax: null,
      postedAt: null,
    })
    expect(jobs[1].sourceJobId).toBe('sr-php-developer')
  })

  it('still records the posting when the detail page fails to load', async () => {
    const fetchMock = vi.fn((input: string) => {
      const url = String(input)
      if (url.endsWith('/career.php')) {
        return Promise.resolve(new Response(LISTING_HTML, { status: 200 }))
      }
      return Promise.resolve(new Response('', { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const jobs = await bdtaskSource.fetchJobs()

    expect(jobs).toHaveLength(2)
    expect(jobs[0]).toMatchObject({
      title: 'Senior Software Engineer (Python/Django)',
      rawDescription: '',
      location: null,
    })
  })

  it('throws when the listing status is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })))

    await expect(bdtaskSource.fetchJobs()).rejects.toThrow('503')
  })
})
