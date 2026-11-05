import { describe, it, expect, vi } from 'vitest'
import { emptyResume } from '@job-hunter/shared'
import { createMaterialsGenerator } from '../../src/materials/materialsGenerator'
import type { LlmProvider } from '../../src/llm/types'

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
