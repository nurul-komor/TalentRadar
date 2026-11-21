import type { Profile } from '@job-hunter/shared'
import { fetchWithPolicy } from './fetchWithPolicy.js'
import { buildResumeKeywords } from './internetJobSearch.js'

const TAVILY_SEARCH_URL = 'https://api.tavily.com/search'
// Tavily "advanced" searches cost more credits, so cap how many resume-derived
// queries we issue per request.
const MAX_QUERIES = 3
const RESULTS_PER_QUERY = 10

// A normalized internet job, shared by the Tavily engine and the job-board
// fallback so the route maps a single shape to the response.
export interface InternetJob {
  // For board results this is the real JobSourceId; for Tavily results it's the
  // result's hostname (there's no fixed source enum for arbitrary web pages).
  sourceId: string
  // Stable per-source key used to build the synthetic client id.
  sourceKey: string
  title: string
  company: string | null
  description: string
  url: string
  // Human-facing source label (board name or hostname).
  source: string
  location: string | null
  salaryMin: number | null
  salaryMax: number | null
  postedAt: string | null
  matchScore: number
}

interface TavilyResult {
  title?: string
  url?: string
  content?: string
  score?: number
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

// The most specific role phrases we have for the candidate, preferring their
// stated target roles, then their headline, then past job titles.
function candidateRoles(profile: Profile): string[] {
  const roles = [
    ...(profile.preferences?.targetRoles ?? []),
    ...(profile.resume.headline ? [profile.resume.headline] : []),
    ...(profile.resume.experience ?? []).map((entry) => entry.role),
  ]
  return dedupe(roles).slice(0, 2)
}

// The candidate's strongest skills, drawn from the structured resume and falling
// back to the keywords derived from raw CV text when the resume isn't parsed.
function candidateSkills(profile: Profile): string[] {
  const skills = [
    ...(profile.resume.skillGroups ?? []).flatMap((group) => group.skills ?? []),
    ...(profile.resume.projects ?? []).flatMap((project) => project.technologies ?? []),
  ]
  const structured = dedupe(skills)
  if (structured.length > 0) return structured.slice(0, 5)
  return buildResumeKeywords(profile).skills.slice(0, 5)
}

// Turn the candidate's own resume into a handful of targeted web-search queries —
// this is what makes the search personal rather than generic.
export function buildJobQueries(profile: Profile): string[] {
  const roles = candidateRoles(profile)
  const skills = candidateSkills(profile)
  const locationHint = profile.preferences?.remoteOnly
    ? 'remote'
    : profile.resume.location?.country ?? profile.preferences?.locations?.[0] ?? 'remote'

  const queries: string[] = []
  if (roles.length > 0) {
    for (const role of roles) {
      const skillStr = skills.slice(0, 3).join(' ')
      queries.push(`${role} jobs ${skillStr} ${locationHint}`.replace(/\s+/g, ' ').trim())
    }
  } else if (skills.length > 0) {
    queries.push(`${skills.slice(0, 4).join(' ')} developer jobs ${locationHint}`)
  }
  // A broader skills-led query widens coverage beyond the exact role titles.
  if (skills.length > 0 && queries.length < MAX_QUERIES) {
    queries.push(`hiring ${skills.slice(0, 3).join(' ')} jobs ${locationHint}`.replace(/\s+/g, ' ').trim())
  }
  return dedupe(queries).slice(0, MAX_QUERIES)
}

async function searchTavily(apiKey: string, query: string): Promise<TavilyResult[]> {
  const res = await fetchWithPolicy(TAVILY_SEARCH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: 'advanced',
      topic: 'general',
      max_results: RESULTS_PER_QUERY,
      include_answer: false,
    }),
  })
  if (!res.ok) {
    throw new Error(`tavily: unexpected status ${res.status}`)
  }
  const data = (await res.json()) as { results?: TavilyResult[] }
  return Array.isArray(data.results) ? data.results : []
}

// How many of the candidate's skills the result text mentions, as a 0..1 ratio
// capped so a few strong hits already read as a full-coverage match.
function skillOverlap(text: string, skills: string[]): number {
  if (skills.length === 0) return 0
  const haystack = text.toLowerCase()
  let matched = 0
  for (const skill of skills) {
    const token = skill.toLowerCase().trim()
    if (token && haystack.includes(token)) matched += 1
  }
  return Math.min(1, matched / Math.min(skills.length, 6))
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

// Search the open web for jobs matching the candidate's resume via Tavily, then
// rank the de-duplicated results. Each query is issued independently and a failing
// query is skipped, so one bad call never sinks the whole search. The match score
// blends Tavily's own relevance with how many of the candidate's skills the result
// actually mentions.
export async function findJobsViaTavily(
  apiKey: string,
  profile: Profile,
  options: { limit: number }
): Promise<InternetJob[]> {
  const queries = buildJobQueries(profile)
  if (queries.length === 0) return []

  const settled = await Promise.allSettled(queries.map((query) => searchTavily(apiKey, query)))
  const results = settled.flatMap((result) => (result.status === 'fulfilled' ? result.value : []))

  const skills = buildResumeKeywords(profile).skills
  const byUrl = new Map<string, InternetJob>()
  for (const result of results) {
    if (!result.url || !result.title) continue
    const hostname = hostnameOf(result.url)
    if (!hostname) continue

    const content = result.content ?? ''
    const relevance = typeof result.score === 'number' ? result.score : 0
    const overlap = skillOverlap(`${result.title} ${content}`, skills)
    const matchScore = Math.min(100, Math.round(relevance * 60 + overlap * 40))

    const job: InternetJob = {
      sourceId: hostname,
      sourceKey: result.url,
      title: result.title,
      company: null,
      description: content,
      url: result.url,
      source: hostname,
      location: null,
      salaryMin: null,
      salaryMax: null,
      postedAt: null,
      matchScore,
    }
    const existing = byUrl.get(result.url)
    if (!existing || existing.matchScore < matchScore) byUrl.set(result.url, job)
  }

  return [...byUrl.values()].sort((a, b) => b.matchScore - a.matchScore).slice(0, options.limit)
}
