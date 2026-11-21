import { describe, it, expect } from 'vitest'
import type { Profile } from '@job-hunter/shared'
import { emptyResume } from '@job-hunter/shared'
import type { JobSource, RawJobPosting } from '../../src/discovery/types'
import {
  buildResumeKeywords,
  rankPostings,
  findInternetJobs,
} from '../../src/discovery/internetJobSearch'

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

function makePosting(overrides: Partial<RawJobPosting> & { sourceJobId: string }): RawJobPosting {
  return {
    sourceId: 'remoteok',
    url: `https://remoteok.com/remote-jobs/${overrides.sourceJobId}`,
    title: 'Engineer',
    company: 'Acme',
    rawDescription: '',
    location: null,
    salaryMin: null,
    salaryMax: null,
    postedAt: null,
    ...overrides,
  }
}

function fakeSource(id: JobSource['id'], jobs: RawJobPosting[]): JobSource {
  return { id, fetchJobs: async () => jobs }
}

describe('buildResumeKeywords', () => {
  it('collects skills from skill groups and project technologies', () => {
    const profile = makeProfile({
      resume: {
        ...emptyResume(),
        skillGroups: [{ category: 'Languages', skills: ['TypeScript', 'Go'] }],
        projects: [{ name: 'p', url: null, role: 'dev', technologies: ['React'], bullets: [] }],
      },
    })
    const keywords = buildResumeKeywords(profile)
    expect(keywords.skills).toEqual(expect.arrayContaining(['typescript', 'go', 'react']))
  })

  it('derives role words from target roles and experience, dropping stopwords', () => {
    const profile = makeProfile({
      preferences: { targetRoles: ['Backend Engineer'], remoteOnly: true, minSalaryUsd: null, locations: [] },
      resume: {
        ...emptyResume(),
        experience: [{ company: 'Acme', role: 'Senior Developer', startDate: '2020', endDate: null, bullets: [] }],
        skillGroups: [{ category: 'x', skills: ['python'] }],
      },
    })
    const keywords = buildResumeKeywords(profile)
    expect(keywords.roles).toEqual(expect.arrayContaining(['backend', 'engineer', 'senior', 'developer']))
    // "experience" is a stopword and must not leak in as a role token.
    expect(keywords.roles).not.toContain('experience')
  })

  it('falls back to frequent cvText terms when there are no structured skills', () => {
    const profile = makeProfile({
      cvText: 'Kubernetes kubernetes kubernetes docker docker terraform',
    })
    const keywords = buildResumeKeywords(profile)
    expect(keywords.skills).toEqual(expect.arrayContaining(['kubernetes', 'docker', 'terraform']))
  })
})

describe('rankPostings', () => {
  const keywords = { skills: ['typescript', 'react', 'go'], roles: ['engineer'] }

  it('ranks title skill matches above body-only matches', () => {
    const titleMatch = makePosting({ sourceJobId: 'a', title: 'TypeScript Engineer' })
    const bodyMatch = makePosting({ sourceJobId: 'b', title: 'Developer', rawDescription: 'We use typescript here' })
    const ranked = rankPostings([bodyMatch, titleMatch], keywords, 10)
    expect(ranked.map((j) => j.sourceJobId)).toEqual(['a', 'b'])
    expect(ranked[0].matchScore).toBeGreaterThan(ranked[1].matchScore)
  })

  it('drops postings with no skill overlap', () => {
    const noMatch = makePosting({ sourceJobId: 'c', title: 'Plumber', rawDescription: 'pipes' })
    expect(rankPostings([noMatch], keywords, 10)).toEqual([])
  })

  it('caps matchScore at 100 and respects the limit', () => {
    const loaded = makePosting({
      sourceJobId: 'd',
      title: 'TypeScript React Go Engineer',
      rawDescription: 'typescript react go typescript react go',
    })
    const ranked = rankPostings([loaded, makePosting({ sourceJobId: 'e', title: 'Go dev' })], keywords, 1)
    expect(ranked).toHaveLength(1)
    expect(ranked[0].matchScore).toBeLessThanOrEqual(100)
  })
})

describe('findInternetJobs', () => {
  it('queries only internet-wide sources, tolerates a failing source, and ranks results', async () => {
    const profile = makeProfile({
      resume: { ...emptyResume(), skillGroups: [{ category: 'x', skills: ['python'] }] },
    })
    const sources: JobSource[] = [
      fakeSource('remoteok', [makePosting({ sourceJobId: '1', title: 'Python Engineer' })]),
      fakeSource('himalayas', [makePosting({ sourceId: 'himalayas', sourceJobId: '2', title: 'Rust dev' })]),
      // Excluded: a Bangladesh company source is not an internet-wide board.
      fakeSource('bjit', [makePosting({ sourceId: 'bjit', sourceJobId: '3', title: 'Python guru' })]),
      // A failing internet source must not sink the whole request.
      { id: 'weworkremotely', fetchJobs: async () => { throw new Error('down') } },
    ]
    const results = await findInternetJobs(sources, profile, { limit: 10 })
    const ids = results.map((j) => j.sourceJobId)
    expect(ids).toContain('1')
    expect(ids).not.toContain('2') // no python overlap
    expect(ids).not.toContain('3') // excluded source
  })
})
