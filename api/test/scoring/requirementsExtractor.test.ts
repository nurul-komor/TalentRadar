import { describe, it, expect, vi, afterEach } from 'vitest'

const mockParse = vi.fn()

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = { parse: mockParse }
    },
  }
})

describe('createClaudeRequirementsExtractor', () => {
  afterEach(() => {
    mockParse.mockReset()
  })

  it('calls Claude Haiku and returns the parsed requirements with token usage', async () => {
    mockParse.mockResolvedValue({
      parsed_output: {
        requiredSkills: ['typescript', 'react'],
        niceToHaveSkills: ['graphql'],
        minExperienceYears: 2,
        workAuthRequirement: 'any',
        remoteType: 'fully_remote',
      },
      usage: { input_tokens: 1500, output_tokens: 120 },
    })

    const { createClaudeRequirementsExtractor } = await import(
      '../../src/scoring/requirementsExtractor'
    )
    const extractor = createClaudeRequirementsExtractor('test-api-key')

    const result = await extractor({
      title: 'Senior Backend Engineer',
      company: 'Acme',
      rawDescription: '<p>We need 2+ years of TypeScript and React experience.</p>',
    })

    expect(result.requirements).toEqual({
      requiredSkills: ['typescript', 'react'],
      niceToHaveSkills: ['graphql'],
      minExperienceYears: 2,
      workAuthRequirement: 'any',
      remoteType: 'fully_remote',
    })
    expect(result.usage).toEqual({ inputTokens: 1500, outputTokens: 120 })

    const callArgs = mockParse.mock.calls[0][0]
    expect(callArgs.model).toBe('claude-haiku-4-5')
    expect(callArgs.messages[0].content).toContain('We need 2+ years')
  })

  it('throws if Claude returns no parsed output', async () => {
    mockParse.mockResolvedValue({
      parsed_output: null,
      usage: { input_tokens: 1500, output_tokens: 120 },
    })

    const { createClaudeRequirementsExtractor } = await import(
      '../../src/scoring/requirementsExtractor'
    )
    const extractor = createClaudeRequirementsExtractor('test-api-key')

    await expect(
      extractor({ title: 'Engineer', company: 'Acme', rawDescription: 'desc' })
    ).rejects.toThrow('did not return parseable output')
  })
})
