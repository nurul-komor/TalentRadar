import { describe, it, expect, vi } from 'vitest'
import { createRequirementsExtractor } from '../../src/scoring/requirementsExtractor'
import type { LlmProvider } from '../../src/llm/types'

const PARSED_REQUIREMENTS = {
  requiredSkills: ['typescript', 'react'],
  niceToHaveSkills: ['graphql'],
  minExperienceYears: 2,
  workAuthRequirement: 'any',
  remoteType: 'fully_remote',
}

function fakeProvider(output: unknown) {
  const complete = vi.fn().mockResolvedValue({
    output,
    usage: { inputTokens: 1500, outputTokens: 120 },
  })
  const provider: LlmProvider = { name: 'anthropic', complete }
  return { provider, complete }
}

describe('createRequirementsExtractor', () => {
  it('asks the provider for schema-validated output and maps the result + model + usage', async () => {
    const { provider, complete } = fakeProvider(PARSED_REQUIREMENTS)
    const extractor = createRequirementsExtractor(provider, 'claude-haiku-4-5')

    const result = await extractor({
      title: 'Senior Backend Engineer',
      company: 'Acme',
      rawDescription: '<p>We need 2+ years of TypeScript and React experience.</p>',
    })

    expect(result.requirements).toEqual(PARSED_REQUIREMENTS)
    expect(result.usage).toEqual({ inputTokens: 1500, outputTokens: 120 })
    expect(result.model).toBe('claude-haiku-4-5')

    const req = complete.mock.calls[0][0]
    expect(req.model).toBe('claude-haiku-4-5')
    expect(req.schemaName).toBe('job_requirements')
    expect(req.user).toContain('We need 2+ years')
    expect(req.jsonSchema.required).toContain('requiredSkills')
  })

  it('uses whatever model it is configured with (provider-agnostic)', async () => {
    const { provider, complete } = fakeProvider(PARSED_REQUIREMENTS)
    const extractor = createRequirementsExtractor(provider, 'gemini-2.0-flash')

    const result = await extractor({ title: 'Engineer', company: 'Acme', rawDescription: 'desc' })

    expect(result.model).toBe('gemini-2.0-flash')
    expect(complete.mock.calls[0][0].model).toBe('gemini-2.0-flash')
  })

  it('propagates provider errors', async () => {
    const complete = vi.fn().mockRejectedValue(new Error('provider boom'))
    const extractor = createRequirementsExtractor({ name: 'openai', complete }, 'gpt-4o-mini')
    await expect(
      extractor({ title: 'Engineer', company: 'Acme', rawDescription: 'desc' })
    ).rejects.toThrow('provider boom')
  })
})
