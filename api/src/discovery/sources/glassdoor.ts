import { fetchWithPolicy } from '../fetchWithPolicy.js'
import type { JobSource, RawJobPosting } from '../types.js'

// Glassdoor has no public jobs API. Its SPA is backed by an internal GraphQL
// endpoint (POST /graph) that the job-search page calls, guarded by a CSRF
// token embedded in the page HTML and by Cloudflare/bot detection. We mirror
// that browser flow here:
//   1. GET a jobs landing page with a browser-like UA to obtain a CSRF token.
//   2. POST the JobSearchResultsQuery for each keyword to /graph.
//   3. Keep only listings whose title actually matches one of our keywords.
//
// This is BEST-EFFORT by design: Glassdoor frequently blocks non-browser
// clients (403 / JS challenge), in which case the CSRF scrape yields nothing
// and fetchJobs() returns []. It never throws on a block so one hostile source
// can't fail the whole discovery run — only a genuinely unexpected shape does.
const ORIGIN = 'https://www.glassdoor.com'
const GRAPH_URL = `${ORIGIN}/graph`
// A plain jobs page we can scrape the CSRF token from. The specific keyword
// doesn't matter — we only need the token the page ships with.
const TOKEN_SEED_URL = `${ORIGIN}/Job/software-engineer-jobs-SRCH_KO0,17.htm`

// Browser-like UA — Glassdoor rejects the default bot UA outright.
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const NUM_JOBS_PER_KEYWORD = 30

// The titles the user wants to track. A listing is kept when its title contains
// any of these (case-insensitive substring) — so "Senior PHP Developer" and
// "Backend Software Engineer (Node.js)" both match. Keep these lowercase.
const TITLE_KEYWORDS = [
  'php developer',
  'php engineer',
  'software engineer',
  'software developer',
  'backend developer',
  'back-end developer',
  'backend engineer',
  'back-end engineer',
  'frontend developer',
  'front-end developer',
  'frontend engineer',
  'front-end engineer',
  'full stack',
  'full-stack',
  'fullstack',
  'laravel',
  'node.js',
  'nodejs',
  'node js',
  'javascript',
  'typescript',
  'golang',
  'go developer',
] as const

// Distinct queries to send to Glassdoor's search. Fewer, broader queries than
// TITLE_KEYWORDS: the server-side title filter does the precise narrowing, so a
// handful of search terms keeps the request fan-out (and rate-limit wait) small.
const SEARCH_TERMS = [
  'php developer',
  'software engineer',
  'backend developer',
  'frontend developer',
  'full stack developer',
  'laravel developer',
  'node.js developer',
  'golang developer',
] as const

interface GraphAdjustedPay {
  p10?: number | null
  p90?: number | null
}

interface GraphHeader {
  jobTitleText?: string | null
  employerNameFromSearch?: string | null
  locationName?: string | null
  ageInDays?: number | null
  payPeriodAdjustedPay?: GraphAdjustedPay | null
}

interface GraphJob {
  listingId?: number | string | null
  jobTitleText?: string | null
  descriptionFragmentText?: string | null
  jobLink?: string | null
}

interface GraphJobView {
  header?: GraphHeader | null
  job?: GraphJob | null
}

interface GraphJobListing {
  jobview?: GraphJobView | null
}

interface GraphResponseItem {
  data?: { jobListings?: { jobListings?: GraphJobListing[] | null } | null } | null
}

const JOB_SEARCH_QUERY = `
query JobSearchResultsQuery($keyword: String, $numJobsToShow: Int!) {
  jobListings(
    contextHolder: {searchParams: {keyword: $keyword, numPerPage: $numJobsToShow, searchType: SR}}
  ) {
    jobListings {
      jobview {
        header {
          jobTitleText
          employerNameFromSearch
          locationName
          ageInDays
          payPeriodAdjustedPay { p10 p90 }
        }
        job {
          listingId
          jobTitleText
          descriptionFragmentText
          jobLink
        }
      }
    }
  }
}`

function titleMatches(title: string): boolean {
  const lower = title.toLowerCase()
  return TITLE_KEYWORDS.some((keyword) => lower.includes(keyword))
}

// Glassdoor CSRF tokens look like `aaaa:bbbb` and are embedded in the page JSON
// as `"token":"<value>"`. Scrape the first one we find.
function extractCsrfToken(html: string): string | null {
  const match = html.match(/"token":"([^"]+:[^"]+)"/)
  return match ? match[1] : null
}

async function fetchCsrfToken(): Promise<string | null> {
  try {
    const res = await fetchWithPolicy(TOKEN_SEED_URL, {
      headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html' },
    })
    if (!res.ok) return null
    return extractCsrfToken(await res.text())
  } catch {
    return null
  }
}

function ageInDaysToIso(ageInDays: number | null | undefined): string | null {
  if (typeof ageInDays !== 'number' || ageInDays < 0) return null
  return new Date(Date.now() - ageInDays * 24 * 60 * 60 * 1000).toISOString()
}

function toPosting(listing: GraphJobListing): RawJobPosting | null {
  const header = listing.jobview?.header
  const job = listing.jobview?.job
  const listingId = job?.listingId
  const title = job?.jobTitleText ?? header?.jobTitleText
  if (listingId == null || !title || !titleMatches(title)) return null

  const pay = header?.payPeriodAdjustedPay
  return {
    sourceId: 'glassdoor' as const,
    sourceJobId: String(listingId),
    url: job?.jobLink
      ? new URL(job.jobLink, ORIGIN).toString()
      : `${ORIGIN}/job-listing/j?jl=${listingId}`,
    title,
    company: header?.employerNameFromSearch ?? 'Unknown company',
    rawDescription: job?.descriptionFragmentText ?? '',
    location: header?.locationName ?? null,
    salaryMin: typeof pay?.p10 === 'number' ? pay.p10 : null,
    salaryMax: typeof pay?.p90 === 'number' ? pay.p90 : null,
    postedAt: ageInDaysToIso(header?.ageInDays),
  }
}

async function searchTerm(term: string, csrfToken: string): Promise<GraphJobListing[]> {
  try {
    const res = await fetchWithPolicy(GRAPH_URL, {
      method: 'POST',
      headers: {
        'User-Agent': BROWSER_UA,
        'Content-Type': 'application/json',
        Accept: '*/*',
        Origin: ORIGIN,
        'gd-csrf-token': csrfToken,
        'apollographql-client-name': 'job-search-next',
      },
      body: JSON.stringify([
        {
          operationName: 'JobSearchResultsQuery',
          variables: { keyword: term, numJobsToShow: NUM_JOBS_PER_KEYWORD },
          query: JOB_SEARCH_QUERY,
        },
      ]),
    })
    if (!res.ok) return []
    const body = (await res.json()) as GraphResponseItem[] | GraphResponseItem
    const items = Array.isArray(body) ? body : [body]
    return items.flatMap((item) => item.data?.jobListings?.jobListings ?? [])
  } catch {
    // Network error, timeout, or non-JSON block page — skip this term.
    return []
  }
}

export const glassdoorSource: JobSource = {
  id: 'glassdoor',
  async fetchJobs(): Promise<RawJobPosting[]> {
    const csrfToken = await fetchCsrfToken()
    // No token means Glassdoor served us a block/challenge page — nothing we can
    // do server-side, so yield nothing rather than hammering /graph with 403s.
    if (!csrfToken) return []

    // De-dupe across search terms by listing id; different terms surface the
    // same posting, and persistPosting would otherwise count them as duplicates.
    const byId = new Map<string, RawJobPosting>()
    for (const term of SEARCH_TERMS) {
      const listings = await searchTerm(term, csrfToken)
      for (const listing of listings) {
        const posting = toPosting(listing)
        if (posting && !byId.has(posting.sourceJobId)) {
          byId.set(posting.sourceJobId, posting)
        }
      }
    }
    return [...byId.values()]
  },
}
