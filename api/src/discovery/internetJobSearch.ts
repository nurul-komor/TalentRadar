import type { Profile } from '@job-hunter/shared'
import type { JobSource, RawJobPosting } from './types.js'

// The generic internet-wide job boards we query live for the resume-matched
// "Find jobs from the internet" feature. The Bangladesh company career pages and
// the government circular feed already populate the normal discovery feed, so
// they're deliberately excluded here — this surface is for broad, global roles.
export const INTERNET_JOB_SOURCE_IDS = [
  'remoteok',
  'weworkremotely',
  'himalayas',
  'adzuna',
] as const

// Words that carry no matching signal, stripped from role/cvText tokens so they
// don't inflate scores. Deliberately small — real skills (java, go, ml) stay.
const STOPWORDS = new Set([
  'and', 'the', 'for', 'with', 'you', 'our', 'are', 'will', 'who', 'all', 'new',
  'per', 'their', 'that', 'this', 'from', 'has', 'have', 'was', 'were', 'but',
  'not', 'can', 'your', 'about', 'into', 'any', 'out', 'use', 'using', 'used',
  'work', 'working', 'team', 'teams', 'role', 'roles', 'job', 'jobs', 'year',
  'years', 'experience', 'strong', 'ability', 'knowledge', 'skills', 'skill',
])

export interface ResumeKeywords {
  // Precise skill/technology phrases — the main matching signal.
  skills: string[]
  // Role/title words (from target roles, past roles, headline) — a lighter,
  // title-focused signal.
  roles: string[]
}

export interface RankedInternetJob extends RawJobPosting {
  matchScore: number
}

function normalize(value: string): string {
  return value.toLowerCase().trim()
}

// Split free text into comparable word tokens, keeping the symbols that are part
// of real tech names (c++, c#, node.js) while dropping stopwords and noise.
function wordTokens(text: string): string[] {
  return normalize(text)
    .split(/[^a-z0-9+#.]+/)
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word))
}

// Derive the keyword sets used for matching from the user's own profile. Skills
// come from the structured resume (skill groups + project technologies); when a
// resume has no structured skills we fall back to the most frequent meaningful
// terms in the raw CV text so the feature still works off an unparsed upload.
export function buildResumeKeywords(profile: Profile): ResumeKeywords {
  const resume = profile.resume
  const skills = new Set<string>()
  for (const group of resume.skillGroups ?? []) {
    for (const skill of group.skills ?? []) {
      const token = normalize(skill)
      if (token.length >= 2) skills.add(token)
    }
  }
  for (const project of resume.projects ?? []) {
    for (const tech of project.technologies ?? []) {
      const token = normalize(tech)
      if (token.length >= 2) skills.add(token)
    }
  }

  const roles = new Set<string>()
  for (const target of profile.preferences?.targetRoles ?? []) {
    for (const word of wordTokens(target)) roles.add(word)
  }
  for (const entry of resume.experience ?? []) {
    for (const word of wordTokens(entry.role)) roles.add(word)
  }
  if (resume.headline) {
    for (const word of wordTokens(resume.headline)) roles.add(word)
  }

  // Fallback: a resume with raw CV text but no parsed skills still has signal —
  // use the most frequent meaningful terms as skill tokens.
  if (skills.size === 0 && profile.cvText) {
    const frequency = new Map<string, number>()
    for (const word of wordTokens(profile.cvText)) {
      frequency.set(word, (frequency.get(word) ?? 0) + 1)
    }
    const top = [...frequency.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 40)
      .map(([word]) => word)
    for (const word of top) skills.add(word)
  }

  return { skills: [...skills], roles: [...roles] }
}

const TITLE_WEIGHT = 3
const BODY_WEIGHT = 1
const ROLE_TITLE_WEIGHT = 1
// Weighted score that maps to a 100% match. ~4 skill hits in the title, or 12 in
// the body, reads as a perfect match — enough to separate strong from weak fits
// without every multi-skill job pinning at 100.
const TARGET_WEIGHT = 12

function postedAtMillis(value: string | null): number {
  if (!value) return 0
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

// Score each posting against the resume keywords and return the best matches,
// most-relevant first (ties broken by recency). Postings with no skill overlap
// are dropped — this feed is defined by relevance to the user's resume.
export function rankPostings(
  postings: RawJobPosting[],
  keywords: ResumeKeywords,
  limit: number
): RankedInternetJob[] {
  const ranked: RankedInternetJob[] = []
  for (const posting of postings) {
    const title = normalize(posting.title)
    const body = normalize(`${posting.title} ${posting.rawDescription} ${posting.location ?? ''}`)

    let weighted = 0
    const matched = new Set<string>()
    for (const skill of keywords.skills) {
      if (!skill) continue
      if (title.includes(skill)) {
        weighted += TITLE_WEIGHT
        matched.add(skill)
      } else if (body.includes(skill)) {
        weighted += BODY_WEIGHT
        matched.add(skill)
      }
    }
    // Role words only count in the title, where they signal the job is the right
    // kind of role rather than merely mentioning a tool.
    for (const role of keywords.roles) {
      if (role && title.includes(role)) weighted += ROLE_TITLE_WEIGHT
    }

    if (matched.size === 0) continue
    const matchScore = Math.min(100, Math.round((weighted / TARGET_WEIGHT) * 100))
    ranked.push({ ...posting, matchScore })
  }

  ranked.sort(
    (a, b) => b.matchScore - a.matchScore || postedAtMillis(b.postedAt) - postedAtMillis(a.postedAt)
  )
  return ranked.slice(0, limit)
}

// Fetch live postings from the internet-wide job boards and rank them against the
// user's resume. Sources are queried concurrently and a failing source is simply
// skipped, so one slow or down board never blocks the whole result.
export async function findInternetJobs(
  sources: JobSource[],
  profile: Profile,
  options: { limit: number }
): Promise<RankedInternetJob[]> {
  const internetSources = sources.filter((source) =>
    (INTERNET_JOB_SOURCE_IDS as readonly string[]).includes(source.id)
  )
  const settled = await Promise.allSettled(internetSources.map((source) => source.fetchJobs()))
  const postings = settled.flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
  const keywords = buildResumeKeywords(profile)
  return rankPostings(postings, keywords, options.limit)
}
