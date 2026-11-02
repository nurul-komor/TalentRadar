import { describe, it, expect, vi, afterEach } from 'vitest'

const mockParse = vi.fn()

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = { parse: mockParse }
    },
  }
})

describe('createClaudeResumeExtractor', () => {
  afterEach(() => {
    mockParse.mockReset()
  })

  it('calls Claude Haiku and returns the parsed resume with token usage', async () => {
    mockParse.mockResolvedValue({
      parsed_output: {
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
      },
      usage: { input_tokens: 2000, output_tokens: 300 },
    })

    const { createClaudeResumeExtractor } = await import('../../src/profile/resumeExtractor')
    const extractor = createClaudeResumeExtractor('test-api-key')

    const result = await extractor('Nurul Komor — Full-Stack Developer at wOow Global since 03/2024.')

    expect(result.resume.fullName).toBe('Nurul Komor')
    expect(result.resume.experience).toEqual([
      { company: 'wOow Global', role: 'Software Engineer', startDate: '03/2024', endDate: null, bullets: [] },
    ])
    expect(result.usage).toEqual({ inputTokens: 2000, outputTokens: 300 })

    const callArgs = mockParse.mock.calls[0][0]
    expect(callArgs.model).toBe('claude-haiku-4-5')
    expect(callArgs.messages[0].content).toContain('Full-Stack Developer at wOow Global')
  })

  it('throws if Claude returns no parsed output', async () => {
    mockParse.mockResolvedValue({
      parsed_output: null,
      usage: { input_tokens: 2000, output_tokens: 300 },
    })

    const { createClaudeResumeExtractor } = await import('../../src/profile/resumeExtractor')
    const extractor = createClaudeResumeExtractor('test-api-key')

    await expect(extractor('some cv text')).rejects.toThrow('did not return parseable output')
  })
})
