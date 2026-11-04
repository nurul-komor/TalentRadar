import { fetchWithPolicy } from '../fetchWithPolicy.js'
import type { JobSource, RawJobPosting } from '../types.js'
import { extractDivByClass, stripTags } from './htmlUtils.js'

// Dynamic Solution Innovators recruits through the hrythmic ATS (Django,
// server-rendered, no JSON API). The company openings page lists each job as a
// link to its detail page; the detail page carries the full description and the
// posted date. We scrape the list, then each detail page.
const ORIGIN = 'https://app.hrythmic.com'
const LISTING_URL = `${ORIGIN}/recruit/openings/company/dsinnovators/`
const COMPANY_NAME = 'Dynamic Solution Innovators'

const OPENING_LINK = /href="(\/recruit\/openings\/[0-9a-f-]{36}\/)"[^>]*>([\s\S]*?)<\/a>/g
const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
}

interface ListingRow {
  uuid: string
  title: string
  url: string
}

function parseListing(html: string): ListingRow[] {
  const seen = new Set<string>()
  const rows: ListingRow[] = []
  for (const match of html.matchAll(OPENING_LINK)) {
    const path = match[1]
    const title = stripTags(match[2])
    if (!title || seen.has(path)) continue
    seen.add(path)
    rows.push({ uuid: path.split('/').filter(Boolean).pop() as string, title, url: `${ORIGIN}${path}` })
  }
  return rows
}

// hrythmic prints dates as "2 Nov 2026"; convert to an ISO date string (UTC).
function parsePostedDate(html: string): string | null {
  const match = /Posted on\s*(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/.exec(html)
  if (!match) return null
  const [, day, mon, year] = match
  const month = MONTHS[mon.toLowerCase()]
  if (!month) return null
  const iso = `${year}-${month}-${day.padStart(2, '0')}T00:00:00.000Z`
  return Number.isNaN(new Date(iso).getTime()) ? null : iso
}

async function toPosting(row: ListingRow): Promise<RawJobPosting> {
  let rawDescription = ''
  let postedAt: string | null = null
  try {
    const res = await fetchWithPolicy(row.url)
    if (res.ok) {
      const html = await res.text()
      const afterLabel = html.slice(html.indexOf('>Description</div>'))
      rawDescription = extractDivByClass(afterLabel, 'flex flex-col gap-5')
      postedAt = parsePostedDate(html)
    }
  } catch {
    // Keep the listing-only posting.
  }

  return {
    sourceId: 'dsinnovators' as const,
    sourceJobId: row.uuid,
    url: row.url,
    title: row.title,
    company: COMPANY_NAME,
    rawDescription,
    // hrythmic exposes neither a structured location nor salary.
    location: null,
    salaryMin: null,
    salaryMax: null,
    postedAt,
  }
}

export const dsInnovatorsSource: JobSource = {
  id: 'dsinnovators',
  async fetchJobs(): Promise<RawJobPosting[]> {
    const res = await fetchWithPolicy(LISTING_URL)
    if (!res.ok) {
      throw new Error(`dsinnovators: unexpected status ${res.status}`)
    }
    const rows = parseListing(await res.text())

    const postings: RawJobPosting[] = []
    for (const row of rows) {
      postings.push(await toPosting(row))
    }
    return postings
  },
}
