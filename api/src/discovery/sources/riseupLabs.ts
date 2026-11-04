import { fetchWithPolicy } from '../fetchWithPolicy.js'
import type { JobSource, RawJobPosting } from '../types.js'
import { decodeEntities } from './htmlUtils.js'

// Riseup Labs runs its careers section on WordPress. The WP REST `jobs` endpoint
// returns every job post ever published (~300, no deadline field exposed), so we
// can't tell open roles from closed ones there. The public careers page, by
// contrast, lists only the currently-open positions. We therefore scrape the
// open-position slugs from that page, then pull each job's title/body/date from
// the WP REST API by slug.
const CAREERS_PAGE = 'https://riseuplabs.com/jobs/'
const WP_BY_SLUG = 'https://riseuplabs.com/wp-json/wp/v2/jobs?slug='
const COMPANY_NAME = 'Riseup Labs'

const JOB_LINK = /href="(https:\/\/riseuplabs\.com\/jobs\/([^"/]+)\/)"/g

interface WpRendered {
  rendered?: string
}

interface WpJob {
  slug?: string
  link?: string
  date_gmt?: string
  title?: WpRendered
  content?: WpRendered
}

function wpDateToIso(date: string | undefined): string | null {
  if (!date) return null
  const parsed = new Date(`${date}Z`)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

// Unique open-position slugs linked from the careers page.
function parseOpenSlugs(html: string): Array<{ slug: string; url: string }> {
  const seen = new Set<string>()
  const result: Array<{ slug: string; url: string }> = []
  for (const match of html.matchAll(JOB_LINK)) {
    const [, url, slug] = match
    if (seen.has(slug)) continue
    seen.add(slug)
    result.push({ slug, url })
  }
  return result
}

async function toPosting(entry: { slug: string; url: string }): Promise<RawJobPosting | null> {
  const res = await fetchWithPolicy(`${WP_BY_SLUG}${encodeURIComponent(entry.slug)}`)
  if (!res.ok) return null
  const body = (await res.json()) as WpJob[]
  const job = body?.[0]
  if (!job) return null

  return {
    sourceId: 'riseup-labs' as const,
    sourceJobId: entry.slug,
    url: job.link ?? entry.url,
    title: decodeEntities(job.title?.rendered ?? 'Unknown title'),
    company: COMPANY_NAME,
    rawDescription: job.content?.rendered ?? '',
    // The WP payload carries no structured location or salary fields.
    location: null,
    salaryMin: null,
    salaryMax: null,
    postedAt: wpDateToIso(job.date_gmt),
  }
}

export const riseupLabsSource: JobSource = {
  id: 'riseup-labs',
  async fetchJobs(): Promise<RawJobPosting[]> {
    const res = await fetchWithPolicy(CAREERS_PAGE)
    if (!res.ok) {
      throw new Error(`riseup-labs: unexpected status ${res.status}`)
    }
    const openSlugs = parseOpenSlugs(await res.text())

    const postings: RawJobPosting[] = []
    for (const entry of openSlugs) {
      const posting = await toPosting(entry)
      if (posting) postings.push(posting)
    }
    return postings
  },
}
