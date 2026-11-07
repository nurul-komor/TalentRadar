import { describe, it, expect, vi } from 'vitest'
import { emptyResume } from '@job-hunter/shared'
import {
  createMaterialsGenerator,
  analyzeQuantification,
  analyzeActionVerbs,
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
    // Country only — the city must never reach the résumé prompt.
    expect(user).toContain('- Country: Bangladesh')
    expect(user).not.toContain('Dhaka')
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
})
