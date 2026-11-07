import { fetchWithPolicy } from '../fetchWithPolicy.js'
import type { JobSource, RawJobPosting } from '../types.js'

// Adzuna is an aggregator with an official, ToS-compliant JSON API — unlike the
// Cloudflare-walled boards (Glassdoor/Bayt/GulfTalent), it actually returns data
// to a server. It needs a free app id + key (https://developer.adzuna.com/).
//
// Endpoint: GET /v1/api/jobs/{country}/search/{page}
//   ?app_id=&app_key=&results_per_page=&what=&category=&content-type=application/json
// Default country is 'ae' (United Arab Emirates — Dubai roles) and category
// 'it-jobs' to keep the feed to tech. Set ADZUNA_COUNTRY to target another
// market. Credentials come from env, injected via createAdzunaSource(env).
const API_ORIGIN = 'https://api.adzuna.com'
const DEFAULT_COUNTRY = 'ae'
const CATEGORY = 'it-jobs'
const RESULTS_PER_PAGE = 50

// Search terms sent to Adzuna's `what` param (title + description match). The
// client-side title filter below narrows these to the roles we actually track.
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

// Keep a listing only when its title contains one of these (case-insensitive
// substring) — so "Senior PHP Developer" and "Backend Software Engineer" match
// but Adzuna's looser description-based hits (e.g. a recruiter role mentioning
// "software engineer") are dropped. Keep lowercase.
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

interface AdzunaResult {
  id?: string | number
  title?: string
  description?: string
  redirect_url?: string
  created?: string
  salary_min?: number | null
  salary_max?: number | null
  company?: { display_name?: string | null } | null
  location?: { display_name?: string | null } | null
}

interface AdzunaResponse {
  results?: AdzunaResult[]
}

interface AdzunaEnv {
  ADZUNA_APP_ID?: string
  ADZUNA_APP_KEY?: string
  ADZUNA_COUNTRY?: string
}

function titleMatches(title: string): boolean {
  const lower = title.toLowerCase()
  return TITLE_KEYWORDS.some((keyword) => lower.includes(keyword))
}

function toPosting(result: AdzunaResult): RawJobPosting | null {
  const id = result.id
  const title = result.title
  if (id == null || !title || !titleMatches(title)) return null

  return {
    sourceId: 'adzuna' as const,
    sourceJobId: String(id),
    url: result.redirect_url ?? `${API_ORIGIN}/v1/api/jobs`,
    title,
    company: result.company?.display_name ?? 'Unknown company',
    rawDescription: result.description ?? '',
    location: result.location?.display_name ?? null,
    salaryMin: typeof result.salary_min === 'number' ? result.salary_min : null,
    salaryMax: typeof result.salary_max === 'number' ? result.salary_max : null,
    // Adzuna returns an ISO-8601 `created` timestamp.
    postedAt: result.created ?? null,
  }
}

async function searchTerm(
  term: string,
  country: string,
  appId: string,
  appKey: string
): Promise<AdzunaResult[]> {
  const params = new URLSearchParams({
    app_id: appId,
    app_key: appKey,
    results_per_page: String(RESULTS_PER_PAGE),
    what: term,
    category: CATEGORY,
    'content-type': 'application/json',
  })
  const url = `${API_ORIGIN}/v1/api/jobs/${country}/search/1?${params.toString()}`
  try {
    const res = await fetchWithPolicy(url, { headers: { Accept: 'application/json' } })
    if (!res.ok) return []
    const body = (await res.json()) as AdzunaResponse
    return body.results ?? []
  } catch {
    // Network error, timeout, or an unexpected non-JSON body — skip this term.
    return []
  }
}

// Factory mirrors createCloudinaryUploader(env): credentials are injected so the
// source is testable and env-driven. Without both keys it yields nothing (the
// discovery run just records zero from this source) rather than erroring.
export function createAdzunaSource(env: AdzunaEnv): JobSource {
  return {
    id: 'adzuna',
    async fetchJobs(): Promise<RawJobPosting[]> {
      const appId = env.ADZUNA_APP_ID
      const appKey = env.ADZUNA_APP_KEY
      if (!appId || !appKey) return []
      const country = env.ADZUNA_COUNTRY || DEFAULT_COUNTRY

      // De-dupe across terms by Adzuna id — the same posting surfaces under
      // multiple search terms, and persistPosting would otherwise count the
      // repeats as duplicates.
      const byId = new Map<string, RawJobPosting>()
      for (const term of SEARCH_TERMS) {
        const results = await searchTerm(term, country, appId, appKey)
        for (const result of results) {
          const posting = toPosting(result)
          if (posting && !byId.has(posting.sourceJobId)) {
            byId.set(posting.sourceJobId, posting)
          }
        }
      }
      return [...byId.values()]
    },
  }
}
