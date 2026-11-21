import { describe, it, expect, vi } from 'vitest'
import { emptyResume } from '@job-hunter/shared'
import {
  createMaterialsGenerator,
  analyzeQuantification,
  analyzeActionVerbs,
  analyzeSkillCoverage,
  analyzeReadability,
  backfillMissingSkills,
} from '../../src/materials/materialsGenerator'
import type { LlmProvider } from '../../src/llm/types'

// A tailored CV whose Experience/Projects bullets are mostly NOT quantified
// (1 of 4 has a number) — below the 75% threshold. The Skills bullet has a
// digit but must be excluded from the ratio.
const WEAK_CV = `# Jane Doe
Android Developer

## Skills
- Languages: Kotlin, Java 17

## Professional Experience
**Android Developer — Acme** (Jan 2022 – Present)
- Built offline sync serving 5,000+ daily users
- Optimized database queries and refactored code for better performance
- Improved app maintainability and code quality

## Projects
**Weather App** — personal
- Developed a weather app with a clean UI`

// Same shape but every Experience/Projects bullet carries a number.
const STRONG_CV = `# Jane Doe
Android Developer

## Professional Experience
**Android Developer — Acme** (Jan 2022 – Present)
- Built offline sync serving 5,000+ daily users
- Cut average query time from ~900ms to ~220ms across 8 modules
- Reduced crash rate from ~2% to under 0.4%

## Projects
**Weather App** — personal
- Shipped a weather app used by 1,200+ installs`

// Fully quantified, but "Developed" opens 4 bullets — action-verb overuse.
const VERB_SPAM_CV = `# Jane Doe
Android Developer

## Professional Experience
**Android Developer — Acme** (Jan 2022 – Present)
- Developed offline sync serving 5,000+ daily users
- Developed a caching layer cutting load time by ~40%
- Developed CI that trimmed build time to 6 minutes

## Projects
**Weather App** — personal
- Developed a weather app used by 1,200+ installs`

// Fully quantified and verb-varied, so the ONLY thing that can trigger a retry
// is keyword coverage. Lists Kotlin but none of the other posting skills.
const SKILLS_CV = `# Jane Doe
Backend Engineer

## Skills
- Programming Languages: Kotlin
- Cloud & DevOps: Docker

## Professional Experience
**Backend Engineer — Acme** (Jan 2022 – Present)
- Shipped an API serving 2M requests/day
- Cut p95 latency from 820ms to 190ms
- Reduced infra spend by 35% across 4 services`

const PARSED_CONTENT = {
  unmetRequirements: ['5+ years Kubernetes'],
  tailoredCv: 'Tailored CV text',
  coverLetter: 'Cover letter text',
  outreachMessage: 'Outreach text',
}

const PROFILE = {
  email: 'user@example.com',
  eligibility: { workAuthorization: 'citizen' as const, countries: [] },
  preferences: { targetRoles: [], remoteOnly: true, minSalaryUsd: null, locations: [] },
  cvText: 'Experienced backend engineer.',
  resume: emptyResume(),
  onboardingCompletedAt: null,
}

function fakeProvider(output: unknown) {
  const complete = vi.fn().mockResolvedValue({
    output,
    usage: { inputTokens: 4000, outputTokens: 1200 },
  })
  const provider: LlmProvider = { name: 'anthropic', complete }
  return { provider, complete }
}

describe('createMaterialsGenerator', () => {
  it('asks the provider for schema-validated output and maps the result + model + usage', async () => {
    const { provider, complete } = fakeProvider(PARSED_CONTENT)
    const generator = createMaterialsGenerator(provider, 'claude-opus-4-8', true)

    const result = await generator({
      job: { title: 'Backend Engineer', company: 'Acme', rawDescription: 'We need Kubernetes experts.' },
      profile: PROFILE,
      requirements: null,
    })

    expect(result.content.tailoredCv).toBe('Tailored CV text')
    expect(result.usage).toEqual({ inputTokens: 4000, outputTokens: 1200 })
    expect(result.model).toBe('claude-opus-4-8')

    const req = complete.mock.calls[0][0]
    expect(req.model).toBe('claude-opus-4-8')
    expect(req.reasoning).toBe(true)
    expect(req.schemaName).toBe('generated_content')
    expect(req.user).toContain('Experienced backend engineer.')
    expect(req.user).toContain('We need Kubernetes experts.')
  })

  it('forces required skills missing from the CV into the prompt as a must-include list', async () => {
    const { provider, complete } = fakeProvider(PARSED_CONTENT)
    const generator = createMaterialsGenerator(provider, 'claude-opus-4-8', true)

    await generator({
      job: { title: 'Backend Engineer', company: 'Acme', rawDescription: 'PHP shop.' },
      // Profile lists JavaScript but not PHP / CodeIgniter.
      profile: {
        ...PROFILE,
        resume: { ...emptyResume(), skillGroups: [{ category: 'Core', skills: ['JavaScript'] }] },
      },
      requirements: {
        requiredSkills: ['PHP', 'CodeIgniter', 'JavaScript'],
        niceToHaveSkills: [],
        softSkills: [],
        minExperienceYears: null,
        workAuthRequirement: 'unknown',
        remoteType: 'unknown',
      },
    })

    const user = complete.mock.calls[0][0].user as string
    expect(user).toContain('MUST still list')
    // The gap (PHP, CodeIgniter) is spelled out; the already-held skill is not re-listed as missing.
    expect(user).toContain('- PHP')
    expect(user).toContain('- CodeIgniter')
    expect(user).not.toContain('- JavaScript')
  })

  it('passes authoritative contact details (incl. location) into the prompt for the header', async () => {
    const { provider, complete } = fakeProvider(PARSED_CONTENT)
    const generator = createMaterialsGenerator(provider, 'claude-opus-4-8', true)

    await generator({
      job: { title: 'Android Developer', company: 'Acme', rawDescription: 'Android role.' },
      profile: {
        ...PROFILE,
        resume: {
          ...emptyResume(),
          fullName: 'Jane Doe',
          phone: '+880 1700-000000',
          location: { city: 'Dhaka', country: 'Bangladesh' },
        },
      },
      requirements: null,
    })

    const user = complete.mock.calls[0][0].user as string
    expect(user).toContain('Candidate contact details')
    // `City, Country` — the ATS searchability check fails a country-only address.
    expect(user).toContain('- Location: Dhaka, Bangladesh')
    expect(user).toContain('- Email: user@example.com')
    expect(user).toContain('- Phone: +880 1700-000000')
  })

  it('passes the reasoning flag through (off for non-reasoning models like gpt-4o-mini)', async () => {
    const { provider, complete } = fakeProvider(PARSED_CONTENT)
    const generator = createMaterialsGenerator(provider, 'gpt-4o-mini', false)

    const result = await generator({
      job: { title: 'Engineer', company: 'Acme', rawDescription: 'desc' },
      profile: PROFILE,
      requirements: null,
    })

    expect(result.model).toBe('gpt-4o-mini')
    expect(complete.mock.calls[0][0].reasoning).toBe(false)
  })

  it('measures only Experience/Projects bullets and flags the number-less ones', () => {
    const stats = analyzeQuantification(WEAK_CV)
    // 4 impact bullets (the "Languages: ... Java 17" Skills bullet is excluded).
    expect(stats.total).toBe(4)
    expect(stats.quantified).toBe(1)
    expect(stats.ratio).toBeCloseTo(0.25)
    expect(stats.weakBullets).toContain('Optimized database queries and refactored code for better performance')
    expect(stats.weakBullets).toContain('Developed a weather app with a clean UI')
  })

  it('regenerates once when under 75% quantified and keeps the stronger draft + summed usage', async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce({
        output: { ...PARSED_CONTENT, tailoredCv: WEAK_CV },
        usage: { inputTokens: 4000, outputTokens: 1200 },
      })
      .mockResolvedValueOnce({
        output: { ...PARSED_CONTENT, tailoredCv: STRONG_CV },
        usage: { inputTokens: 4500, outputTokens: 1300 },
      })
    const generator = createMaterialsGenerator({ name: 'anthropic', complete }, 'claude-opus-4-8', true)

    const result = await generator({
      job: { title: 'Android Developer', company: 'Acme', rawDescription: 'Android role.' },
      profile: PROFILE,
      requirements: null,
    })

    // Two provider calls; the retry carries the weak-bullet feedback.
    expect(complete).toHaveBeenCalledTimes(2)
    const retryUser = complete.mock.calls[1][0].user as string
    expect(retryUser).toContain('REGENERATION')
    expect(retryUser).toContain('25%')
    // Keeps the stronger draft and sums token usage across both calls.
    expect(result.content.tailoredCv).toBe(STRONG_CV)
    expect(result.usage).toEqual({ inputTokens: 8500, outputTokens: 2500 })
  })

  it('flags action verbs that open more than two Experience/Projects bullets', () => {
    expect(analyzeActionVerbs(VERB_SPAM_CV).overused).toEqual([{ verb: 'developed', count: 4 }])
    // STRONG_CV varies its verbs — nothing overused.
    expect(analyzeActionVerbs(STRONG_CV).overused).toEqual([])
  })

  it('regenerates on action-verb overuse even when quantification already passes', async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce({
        output: { ...PARSED_CONTENT, tailoredCv: VERB_SPAM_CV },
        usage: { inputTokens: 4000, outputTokens: 1200 },
      })
      .mockResolvedValueOnce({
        output: { ...PARSED_CONTENT, tailoredCv: STRONG_CV },
        usage: { inputTokens: 4500, outputTokens: 1300 },
      })
    const generator = createMaterialsGenerator({ name: 'anthropic', complete }, 'claude-opus-4-8', true)

    const result = await generator({
      job: { title: 'Android Developer', company: 'Acme', rawDescription: 'Android role.' },
      profile: PROFILE,
      requirements: null,
    })

    expect(complete).toHaveBeenCalledTimes(2)
    const retryUser = complete.mock.calls[1][0].user as string
    expect(retryUser).toContain('Action-verb overuse')
    expect(retryUser).toContain('"developed" ×4')
    // The verb-varied draft scores higher and is kept.
    expect(result.content.tailoredCv).toBe(STRONG_CV)
  })

  it('does not regenerate when the first draft already clears the threshold', async () => {
    const complete = vi.fn().mockResolvedValue({
      output: { ...PARSED_CONTENT, tailoredCv: STRONG_CV },
      usage: { inputTokens: 4000, outputTokens: 1200 },
    })
    const generator = createMaterialsGenerator({ name: 'anthropic', complete }, 'claude-opus-4-8', true)

    await generator({
      job: { title: 'Android Developer', company: 'Acme', rawDescription: 'Android role.' },
      profile: PROFILE,
      requirements: null,
    })

    expect(complete).toHaveBeenCalledTimes(1)
  })

  it('propagates provider errors', async () => {
    const complete = vi.fn().mockRejectedValue(new Error('provider boom'))
    const generator = createMaterialsGenerator({ name: 'gemini', complete }, 'gemini-2.0-flash', false)
    await expect(
      generator({
        job: { title: 'Engineer', company: 'Acme', rawDescription: 'desc' },
        profile: PROFILE,
        requirements: null,
      })
    ).rejects.toThrow('provider boom')
  })

  it('names the uncovered posting keywords in the retry prompt', async () => {
    const { provider, complete } = fakeProvider({ ...PARSED_CONTENT, tailoredCv: SKILLS_CV })
    const generator = createMaterialsGenerator(provider, 'claude-opus-4-8', true)

    await generator({
      job: { title: 'Backend Engineer', company: 'Acme', rawDescription: 'desc' },
      profile: PROFILE,
      requirements: {
        requiredSkills: ['Kotlin', 'ClickHouse', 'Version control'],
        niceToHaveSkills: ['GitHub Actions'],
        softSkills: ['Motivated'],
        minExperienceYears: null,
        workAuthRequirement: 'unknown',
        remoteType: 'unknown',
      },
    })

    expect(complete).toHaveBeenCalledTimes(2)
    const retryUser = complete.mock.calls[1][0].user as string
    const marker = 'Keyword coverage (HIGHEST PRIORITY)'
    expect(retryUser).toContain(marker)
    // Scope the assertions to the coverage block: the prompt's separate
    // "missing from the master CV" block lists every skill for this bare
    // profile, Kotlin included, and would mask the distinction being tested.
    const coverageBlock = retryUser.slice(retryUser.indexOf(marker)).split('\n\n')[0]
    // Absent from SKILLS_CV — each must be named back to the model.
    expect(coverageBlock).toContain('- ClickHouse')
    expect(coverageBlock).toContain('- Version control')
    expect(coverageBlock).toContain('- GitHub Actions')
    expect(coverageBlock).toContain('- Motivated')
    // Already spelled out in SKILLS_CV, so not reported as an uncovered keyword.
    expect(coverageBlock).not.toContain('- Kotlin')
  })

  it('names over-long blocks and stray bold in the retry prompt', async () => {
    const FAT_CV = [
      '# Jane Doe',
      '## Summary',
      `A **senior** engineer. ${'word '.repeat(45).trim()}`,
      '## Professional Experience',
      '**Backend Engineer — Acme** (Jan 2022 – Present)',
      '- Cut p95 latency by **40%** across 4 services',
      '- Shipped an API serving 2M requests/day',
      '- Reduced infra spend by 35% in 6 months',
    ].join('\n')
    const { provider, complete } = fakeProvider({ ...PARSED_CONTENT, tailoredCv: FAT_CV })
    const generator = createMaterialsGenerator(provider, 'claude-opus-4-8', true)

    await generator({
      job: { title: 'Backend Engineer', company: 'Acme', rawDescription: 'desc' },
      profile: PROFILE,
      requirements: null,
    })

    expect(complete).toHaveBeenCalledTimes(2)
    const retryUser = complete.mock.calls[1][0].user as string
    expect(retryUser).toContain('exceed the 40-word ceiling')
    expect(retryUser).toContain('too much bold styling')
    // The bolded fragments are named back so the retry knows what to unbold,
    // while the legitimate title-line bold is not reported.
    expect(retryUser).toContain('- senior')
    expect(retryUser).toContain('- 40%')
    expect(retryUser).not.toContain('- Backend Engineer — Acme')
  })

  it('backfills into ## Skills whatever the model still omits after the retry', async () => {
    // The provider returns the same keyword-light CV both times, so the retry
    // fails to fix it — the deterministic backfill is the only thing standing
    // between the candidate and a red X on the scan.
    const { provider } = fakeProvider({ ...PARSED_CONTENT, tailoredCv: SKILLS_CV })
    const generator = createMaterialsGenerator(provider, 'claude-opus-4-8', true)

    const result = await generator({
      job: { title: 'Backend Engineer', company: 'Acme', rawDescription: 'desc' },
      profile: PROFILE,
      requirements: {
        requiredSkills: ['Kotlin', 'ClickHouse', 'Version control'],
        niceToHaveSkills: ['GitHub Actions'],
        softSkills: ['Motivated'],
        minExperienceYears: null,
        workAuthRequirement: 'unknown',
        remoteType: 'unknown',
      },
    })

    const cv = result.content.tailoredCv
    expect(cv).toContain('- Additional Skills: ClickHouse, Version control, GitHub Actions, Motivated')
    // Appended inside the Skills section, before the next heading.
    expect(cv.indexOf('Additional Skills')).toBeLessThan(cv.indexOf('## Professional Experience'))
    // Coverage is now total, and the work history was left alone.
    expect(analyzeSkillCoverage(cv, ['Kotlin', 'ClickHouse', 'Version control', 'GitHub Actions', 'Motivated']).missing).toEqual([])
    expect(cv).toContain('- Shipped an API serving 2M requests/day')
  })
})

describe('analyzeReadability', () => {
  it('flags text blocks over 40 words, ignoring headings', () => {
    const long = `w `.repeat(45).trim()
    const cv = `## Summary\n${long}\n\n## Professional Experience\n- Short bullet with 5 words`
    const { longBlocks } = analyzeReadability(cv)
    expect(longBlocks).toHaveLength(1)
    expect(longBlocks[0]).toBe(long)
  })

  it('does not count bold markers toward the word budget', () => {
    const cv = `**${'w '.repeat(39).trim()}**`
    expect(analyzeReadability(cv).longBlocks).toEqual([])
  })

  it('allows bold on Experience and Projects title lines', () => {
    const cv = [
      '## Professional Experience',
      '**Backend Engineer — Acme** (Jan 2022 – Present)',
      '- Cut latency by 40%',
      '## Projects',
      '**Weather App** — personal',
    ].join('\n')
    expect(analyzeReadability(cv).strayBold).toEqual([])
  })

  it('flags bold inside bullets, the summary, and skills labels', () => {
    const cv = [
      '## Summary',
      'A **senior** engineer.',
      '## Skills',
      '- **Programming Languages**: Kotlin',
      '## Professional Experience',
      '**Backend Engineer — Acme** (Jan 2022 – Present)',
      '- Cut latency by **40%** across **8** services',
    ].join('\n')
    expect(analyzeReadability(cv).strayBold).toEqual([
      'senior',
      'Programming Languages',
      '40%',
      '8',
    ])
  })
})

describe('skill coverage audit', () => {
  // Returns the materials draft for the first call(s) and the audit verdict for
  // the one made with the audit model, so a test can assert on both.
  function auditProvider(missingSkills: string[], cv = SKILLS_CV) {
    const complete = vi.fn().mockImplementation((req: { model: string }) =>
      req.model === 'claude-haiku-4-5'
        ? { output: { missingSkills }, usage: { inputTokens: 900, outputTokens: 40 } }
        : { output: { ...PARSED_CONTENT, tailoredCv: cv }, usage: { inputTokens: 4000, outputTokens: 1200 } }
    )
    return { provider: { name: 'anthropic', complete } as LlmProvider, complete }
  }

  it('backfills skills the requirements extractor never surfaced', async () => {
    // ClickHouse is in the posting but absent from `requirements`, so the
    // deterministic check cannot see it — only the auditor can.
    const { provider, complete } = auditProvider(['ClickHouse', 'Kafka'])
    const generator = createMaterialsGenerator(provider, 'claude-opus-4-8', true, 'claude-haiku-4-5')

    const result = await generator({
      job: { title: 'Backend Engineer', company: 'Acme', rawDescription: 'We run ClickHouse and Kafka.' },
      profile: PROFILE,
      requirements: {
        requiredSkills: ['Kotlin'],
        niceToHaveSkills: [],
        softSkills: [],
        minExperienceYears: null,
        workAuthRequirement: 'unknown',
        remoteType: 'unknown',
      },
    })

    const auditCall = complete.mock.calls.find((c) => c[0].model === 'claude-haiku-4-5')?.[0]
    expect(auditCall.user).toContain('We run ClickHouse and Kafka.')
    expect(auditCall.user).toContain('Backend Engineer')
    expect(result.content.tailoredCv).toContain('- Additional Skills: ClickHouse, Kafka')
    // Audit tokens are billed on top of generation.
    expect(result.usage.outputTokens).toBe(1200 + 40)
  })

  it('ignores audit entries that are already present in the CV', async () => {
    // The auditor wrongly reports Kotlin, which SKILLS_CV does list.
    const { provider } = auditProvider(['Kotlin', 'ClickHouse'])
    const generator = createMaterialsGenerator(provider, 'claude-opus-4-8', true, 'claude-haiku-4-5')

    const result = await generator({
      job: { title: 'Backend Engineer', company: 'Acme', rawDescription: 'desc' },
      profile: PROFILE,
      requirements: null,
    })

    expect(result.content.tailoredCv).toContain('- Additional Skills: ClickHouse')
    expect(result.content.tailoredCv).not.toContain('Kotlin, ClickHouse')
  })

  it('still returns materials when the audit call fails', async () => {
    const complete = vi.fn().mockImplementation((req: { model: string }) => {
      if (req.model === 'claude-haiku-4-5') throw new Error('audit boom')
      return {
        output: { ...PARSED_CONTENT, tailoredCv: SKILLS_CV },
        usage: { inputTokens: 4000, outputTokens: 1200 },
      }
    })
    const generator = createMaterialsGenerator(
      { name: 'anthropic', complete },
      'claude-opus-4-8',
      true,
      'claude-haiku-4-5'
    )

    const result = await generator({
      job: { title: 'Backend Engineer', company: 'Acme', rawDescription: 'desc' },
      profile: PROFILE,
      requirements: null,
    })

    expect(result.content.tailoredCv).toContain('## Professional Experience')
  })

  it('skips the audit entirely when no audit model is configured', async () => {
    const { provider, complete } = fakeProvider({ ...PARSED_CONTENT, tailoredCv: SKILLS_CV })
    const generator = createMaterialsGenerator(provider, 'claude-opus-4-8', true)

    await generator({
      job: { title: 'Backend Engineer', company: 'Acme', rawDescription: 'desc' },
      profile: PROFILE,
      requirements: null,
    })

    expect(complete.mock.calls.every((c) => c[0].model === 'claude-opus-4-8')).toBe(true)
  })
})

describe('analyzeSkillCoverage', () => {
  it('matches literally but tolerates casing and punctuation differences', () => {
    const cv = '## Skills\n- Backend: Express.js, AWS Services, GitHub Actions'
    const { missing, covered, total } = analyzeSkillCoverage(cv, [
      'express js',
      'Aws services',
      'Github Actions',
    ])
    expect(missing).toEqual([])
    expect(covered).toBe(3)
    expect(total).toBe(3)
  })

  it('does not count a near-synonym or a substring as coverage', () => {
    const cv = '## Skills\n- Tools: Git, Jest, PostgreSQL\n- Practices: Testing'
    // "Git" must not satisfy "Version control"; "Testing" must not satisfy
    // "Software testing"; "PostgreSQL" must not satisfy "Database management".
    const { missing } = analyzeSkillCoverage(cv, [
      'Version control',
      'Software testing',
      'Database management',
      'Git',
    ])
    expect(missing).toEqual(['Version control', 'Software testing', 'Database management'])
  })

  it('does not let a short skill match inside a longer word', () => {
    // " go " must not match "Google" / "Mongo".
    expect(analyzeSkillCoverage('Worked with Google and MongoDB', ['Go']).missing).toEqual(['Go'])
  })

  it('skips single-character skills rather than scoring them as false hits', () => {
    const { total, missing } = analyzeSkillCoverage('## Skills\n- Languages: Rust', ['C++', 'R'])
    expect(total).toBe(0)
    expect(missing).toEqual([])
  })

  it('deduplicates skills that normalize to the same term', () => {
    const cv = '## Skills\n- Cloud: AWS'
    expect(analyzeSkillCoverage(cv, ['AWS', 'aws', '  AWS  ']).total).toBe(1)
    // Punctuation is a separator, not noise, so "A.W.S." is a distinct term
    // (it normalizes to "a w s") and is correctly reported as uncovered.
    expect(analyzeSkillCoverage(cv, ['A.W.S.']).missing).toEqual(['A.W.S.'])
  })
})

describe('backfillMissingSkills', () => {
  it('appends inside the Skills section, after the existing bullets', () => {
    const out = backfillMissingSkills(SKILLS_CV, ['ClickHouse'])
    const lines = out.split('\n')
    const added = lines.findIndex((l) => l.startsWith('- Additional Skills:'))
    expect(lines[added - 1]).toBe('- Cloud & DevOps: Docker')
    expect(lines[added + 1]).toBe('')
    expect(out).toContain('## Professional Experience')
  })

  it('returns the CV untouched when nothing is missing', () => {
    expect(backfillMissingSkills(SKILLS_CV, [])).toBe(SKILLS_CV)
  })

  it('splits a long backfill across bullets so no line trips the 40-word check', () => {
    const many = Array.from({ length: 60 }, (_, i) => `Skill${i}`)
    const out = backfillMissingSkills(SKILLS_CV, many)
    // Every skill survives the split...
    for (const skill of many) expect(out).toContain(skill)
    // ...and no resulting block exceeds the readability ceiling.
    expect(analyzeReadability(out).longBlocks).toEqual([])
    expect(out).toContain('- Additional Skills: Skill0')
  })

  it('adds a Skills section when the draft has none', () => {
    const out = backfillMissingSkills('# Jane Doe\n\n## Education\n- BSc', ['Kotlin'])
    expect(out).toContain('## Skills\n- Additional Skills: Kotlin')
  })
})
