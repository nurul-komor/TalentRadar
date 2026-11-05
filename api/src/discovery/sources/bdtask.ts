import { fetchWithPolicy } from '../fetchWithPolicy.js'
import type { JobSource, RawJobPosting } from '../types.js'

// Bdtask's careers page is plain server-rendered HTML (no JSON API). The listing
// at career.php gives each job's title and a link to its detail page; the detail
// page carries the description, location, and salary. We scrape the listing and
// then fetch each detail page. HTML scraping is inherently brittle — if a detail
// page can't be parsed we still record the posting from the listing row.
const ORIGIN = 'https://www.bdtask.com'
const LISTING_URL = `${ORIGIN}/career.php`
const COMPANY_NAME = 'Bdtask'

const JOB_POST_BLOCK = /<div class="job_post">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/g
const TITLE_RE = /<h3 class="job-title[^"]*">([\s\S]*?)<\/h3>/
const HREF_RE = /href="(career\/[^"]+\.php)"/

interface ListingRow {
  title: string
  slug: string
  url: string
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;/g, "'")
    .replace(/&#8217;/g, '’')
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim()
}

function parseListing(html: string): ListingRow[] {
  const rows: ListingRow[] = []
  for (const match of html.matchAll(JOB_POST_BLOCK)) {
    const block = match[1]
    const title = TITLE_RE.exec(block)?.[1]
    const href = HREF_RE.exec(block)?.[1]
    if (!title || !href) continue
    const slug = href.replace(/^career\//, '').replace(/\.php$/, '')
    rows.push({ title: stripTags(title), slug, url: `${ORIGIN}/${href}` })
  }
  return rows
}

// A detail page splits the posting across several sibling
// <div class="job_details_content"> blocks — one per section (Job Context, Job
// Requirements, Skills, Salary, …). Extract the inner HTML of every block and
// join them so the whole description is captured, not just the first section.
// Each block's end is found by counting opening/closing <div> tags so nested
// markup is handled correctly.
function extractContent(html: string): string {
  const open = /<div[^>]*class="[^"]*job_details_content[^"]*"[^>]*>/g
  const sections: string[] = []
  let match: RegExpExecArray | null
  while ((match = open.exec(html)) !== null) {
    let depth = 1
    const start = match.index + match[0].length
    const tag = /<\/?div\b[^>]*>/g
    tag.lastIndex = start
    let end = html.length
    let inner: RegExpExecArray | null
    while ((inner = tag.exec(html)) !== null) {
      depth += inner[0].startsWith('</') ? -1 : 1
      if (depth === 0) {
        end = inner.index
        break
      }
    }
    sections.push(html.slice(start, end).trim())
    // Resume scanning after this block so its closing </div> isn't re-counted.
    open.lastIndex = end
  }
  return sections.join('\n').trim()
}

function labelledValue(html: string, label: string): string | null {
  const re = new RegExp(`<h3[^>]*>\\s*${label}\\s*</h3>\\s*<p>([\\s\\S]*?)</p>`, 'i')
  const value = re.exec(html)?.[1]
  const text = value ? stripTags(value) : ''
  return text || null
}

async function toPosting(row: ListingRow): Promise<RawJobPosting> {
  let rawDescription = ''
  let location: string | null = null
  try {
    const res = await fetchWithPolicy(row.url)
    if (res.ok) {
      const html = await res.text()
      rawDescription = extractContent(html)
      location = labelledValue(html, 'Job Location')
    }
  } catch {
    // Keep the listing-only posting rather than dropping it.
  }

  return {
    sourceId: 'bdtask' as const,
    sourceJobId: row.slug,
    url: row.url,
    title: row.title,
    company: COMPANY_NAME,
    rawDescription,
    location,
    // Bdtask lists salary only as free text (often "Negotiable"), never a number,
    // and exposes no publish date.
    salaryMin: null,
    salaryMax: null,
    postedAt: null,
  }
}

export const bdtaskSource: JobSource = {
  id: 'bdtask',
  async fetchJobs(): Promise<RawJobPosting[]> {
    const res = await fetchWithPolicy(LISTING_URL)
    if (!res.ok) {
      throw new Error(`bdtask: unexpected status ${res.status}`)
    }
    const html = await res.text()

    const rows = parseListing(html)
    const postings: RawJobPosting[] = []
    for (const row of rows) {
      postings.push(await toPosting(row))
    }
    return postings
  },
}
