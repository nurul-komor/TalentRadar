import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Profile } from '@job-hunter/shared'
import { emptyResume } from '@job-hunter/shared'

const fetchWithPolicy = vi.hoisted(() => vi.fn())
vi.mock('../../src/discovery/fetchWithPolicy', () => ({ fetchWithPolicy }))

import { buildJobQueries, findJobsViaTavily } from '../../src/discovery/tavilyJobSearch'

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    email: 'candidate@example.com',
    eligibility: { workAuthorization: 'unknown', countries: [] },
    preferences: { targetRoles: [], remoteOnly: true, minSalaryUsd: null, locations: [] },
    cvText: null,
    resume: emptyResume(),
    onboardingCompletedAt: null,
    ...overrides,
  }
}

function tavilyResponse(results: Array<{ title?: string; url?: string; content?: string; score?: number }>) {
  return { ok: true, status: 200, json: async () => ({ results }) }
}

describe('buildJobQueries', () => {
  it('builds role + skill queries from the resume', () => {
    const profile = makeProfile({
      preferences: { targetRoles: ['Backend Engineer'], remoteOnly: true, minSalaryUsd: null, locations: [] },
      resume: { ...emptyResume(), skillGroups: [{ category: 'x', skills: ['TypeScript', 'Go', 'Postgres'] }] },
    })
    const queries = buildJobQueries(profile)
    expect(queries.length).toBeGreaterThan(0)
    expect(queries[0].toLowerCase()).toContain('backend engineer')
    expect(queries[0].toLowerCase()).toContain('typescript')
    expect(queries[0].toLowerCase()).toContain('remote')
  })

  it('falls back to a skills-led query when there are no roles', () => {
    const profile = makeProfile({
      resume: { ...emptyResume(), skillGroups: [{ category: 'x', skills: ['Rust', 'WASM'] }] },
    })
    const queries = buildJobQueries(profile)
    expect(queries.join(' ').toLowerCase()).toContain('rust')
  })

  it('returns no queries when there is nothing to search on', () => {
    expect(buildJobQueries(makeProfile())).toEqual([])
  })
})

describe('findJobsViaTavily', () => {
  beforeEach(() => fetchWithPolicy.mockReset())

  const profile = makeProfile({
    preferences: { targetRoles: ['Frontend Engineer'], remoteOnly: true, minSalaryUsd: null, locations: [] },
    resume: { ...emptyResume(), skillGroups: [{ category: 'x', skills: ['react', 'typescript'] }] },
  })

  it('dedupes by url, derives the source hostname, and ranks by relevance + skill overlap', async () => {
    fetchWithPolicy.mockResolvedValue(
      tavilyResponse([
        { title: 'React TypeScript Engineer', url: 'https://jobs.example.com/a', content: 'react typescript role', score: 0.9 },
        // Duplicate url, lower score — must be collapsed to the single best entry.
        { title: 'React TypeScript Engineer', url: 'https://jobs.example.com/a', content: 'react', score: 0.2 },
        { title: 'Unrelated post', url: 'https://www.blog.example.org/x', content: 'gardening tips', score: 0.1 },
      ])
    )
    const jobs = await findJobsViaTavily('key', profile, { limit: 10 })

    const urls = jobs.map((j) => j.url)
    expect(urls.filter((u) => u === 'https://jobs.example.com/a')).toHaveLength(1)
    expect(jobs[0].url).toBe('https://jobs.example.com/a')
    expect(jobs[0].matchScore).toBeGreaterThan(jobs[jobs.length - 1].matchScore)
    // Hostname is normalized (www stripped) and used as the display source.
    const blog = jobs.find((j) => j.url.includes('blog.example.org'))
    expect(blog?.source).toBe('blog.example.org')
  })

  it('tolerates a failing query without sinking the whole search', async () => {
    let call = 0
    fetchWithPolicy.mockImplementation(async () => {
      call += 1
      if (call === 1) {
        return tavilyResponse([{ title: 'React dev', url: 'https://x.com/1', content: 'react', score: 0.5 }])
      }
      // A down/erroring Tavily call surfaces as a non-OK response; searchTavily
      // throws on it and findJobsViaTavily skips that query.
      return { ok: false, status: 503, json: async () => ({}) }
    })
    const jobs = await findJobsViaTavily('key', profile, { limit: 10 })
    expect(jobs.map((j) => j.url)).toContain('https://x.com/1')
  })
})
