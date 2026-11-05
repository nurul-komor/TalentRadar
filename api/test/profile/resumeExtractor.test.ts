import { describe, it, expect, vi } from 'vitest'
import { createResumeExtractor } from '../../src/profile/resumeExtractor'
import type { LlmProvider } from '../../src/llm/types'

const PARSED_RESUME = {
  fullName: 'Nurul Komor',
  headline: 'Full-Stack Developer',
  phone: null,
  links: [],
  summary: 'Full-stack engineer.',
  experience: [
    { company: 'wOow Global', role: 'Software Engineer', startDate: '03/2024', endDate: null, bullets: [] },
  ],
  projects: [],
  skillGroups: [],
  education: [],
}

function fakeProvider(output: unknown) {
  const complete = vi.fn().mockResolvedValue({
    output,
    usage: { inputTokens: 2000, outputTokens: 300 },
  })
  const provider: LlmProvider = { name: 'anthropic', complete }
  return { provider, complete }
}

describe('createResumeExtractor', () => {
  it('asks the provider for schema-validated output and maps the result + model + usage', async () => {
    const { provider, complete } = fakeProvider(PARSED_RESUME)
    const extractor = createResumeExtractor(provider, 'claude-haiku-4-5')

    const result = await extractor('Nurul Komor — Full-Stack Developer at wOow Global since 03/2024.')

    expect(result.resume.fullName).toBe('Nurul Komor')
    expect(result.resume.experience).toEqual([
      { company: 'wOow Global', role: 'Software Engineer', startDate: '03/2024', endDate: null, bullets: [] },
    ])
    expect(result.usage).toEqual({ inputTokens: 2000, outputTokens: 300 })
    expect(result.model).toBe('claude-haiku-4-5')

    const req = complete.mock.calls[0][0]
    expect(req.model).toBe('claude-haiku-4-5')
    expect(req.schemaName).toBe('resume')
    expect(req.user).toContain('Full-Stack Developer at wOow Global')
    expect(req.jsonSchema.required).toContain('experience')
  })

  it('uses whatever model it is configured with (provider-agnostic)', async () => {
    const { provider, complete } = fakeProvider(PARSED_RESUME)
    const extractor = createResumeExtractor(provider, 'gpt-4o-mini')

    const result = await extractor('some cv text')

    expect(result.model).toBe('gpt-4o-mini')
    expect(complete.mock.calls[0][0].model).toBe('gpt-4o-mini')
  })

  it('propagates provider errors', async () => {
    const complete = vi.fn().mockRejectedValue(new Error('provider boom'))
    const extractor = createResumeExtractor({ name: 'openai', complete }, 'gpt-4o-mini')
    await expect(extractor('cv')).rejects.toThrow('provider boom')
  })
})
