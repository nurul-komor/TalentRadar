import { fetchWithPolicy } from '../fetchWithPolicy.js'
import type { JobSource, RawJobPosting } from '../types.js'
import { decodeEntities, extractDivByClass, stripTags } from './htmlUtils.js'

// SELISE recruits through the hirebee.ai ATS, which (unlike easy.jobs) renders its
// listings server-side as HTML with no JSON API. We scrape the company job list,
// then each job's detail page for the description. Location is already on the list
// card. HTML scraping is brittle, so a failed detail fetch still yields a posting.
const ORIGIN = 'https://ats.hirebee.ai'
const LISTING_URL = `${ORIGIN}/en/company/jobs/selise-bangladesh-ltd`
const COMPANY_NAME = 'SELISE Digital Platforms'

const CARD_SPLIT = /<div class="jobs-card">/
const TITLE_RE = /class="job-title-bl"[^>]*href="(\/en\/jobs\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/
const LOC_RE = /last-job-box-date-loc">([\s\S]*?)<\/div>\s*<\/div>/

interface ListingRow {
  title: string
  slug: string
  url: string
  location: string | null
}

function parseListing(html: string): ListingRow[] {
  const rows: ListingRow[] = []
  for (const card of html.split(CARD_SPLIT).slice(1)) {
    const titleMatch = TITLE_RE.exec(card)
    if (!titleMatch) continue
    const href = titleMatch[1]
    const slug = href.replace(/^\/en\/jobs\//, '')
    // The date/location block lists several items (city, employment type, term,
    // category) as sibling <p>s; the city is the first one, next to a map icon.
    const locBlock = LOC_RE.exec(card)?.[1]
    const cityHtml = locBlock ? /<p>([\s\S]*?)<\/p>/.exec(locBlock)?.[1] : undefined
    rows.push({
      title: stripTags(titleMatch[2]) || 'Unknown title',
      slug,
      url: `${ORIGIN}${href}`,
      location: cityHtml ? stripTags(cityHtml) || null : null,
    })
  }
  return rows
}

function buildDescription(html: string): string {
  return ['job-desc-box', 'job-responsibilities-box', 'job-qualifications-box']
    .map((token) => extractDivByClass(html, token))
    .filter((part) => part.trim().length > 0)
    .join('\n')
}

async function toPosting(row: ListingRow): Promise<RawJobPosting> {
  let rawDescription = ''
  try {
    const res = await fetchWithPolicy(row.url)
    if (res.ok) {
      rawDescription = buildDescription(await res.text())
    }
  } catch {
    // Keep the listing-only posting.
  }

  return {
    sourceId: 'selise' as const,
    sourceJobId: row.slug,
    url: row.url,
    title: decodeEntities(row.title),
    company: COMPANY_NAME,
    rawDescription,
    location: row.location,
    // hirebee does not expose salary or a publish date on the sampled listings.
    salaryMin: null,
    salaryMax: null,
    postedAt: null,
  }
}

export const seliseSource: JobSource = {
  id: 'selise',
  async fetchJobs(): Promise<RawJobPosting[]> {
    const res = await fetchWithPolicy(LISTING_URL)
    if (!res.ok) {
      throw new Error(`selise: unexpected status ${res.status}`)
    }
    const rows = parseListing(await res.text())

    const postings: RawJobPosting[] = []
    for (const row of rows) {
      postings.push(await toPosting(row))
    }
    return postings
  },
}
