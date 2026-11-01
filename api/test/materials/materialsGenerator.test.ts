import { describe, it, expect, vi, afterEach } from 'vitest'
import { emptyResume } from '@job-hunter/shared'

const mockParse = vi.fn()

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = { parse: mockParse }
    },
  }
})

describe('createClaudeMaterialsGenerator', () => {
  afterEach(() => {
    mockParse.mockReset()
  })

  it('calls Claude Opus and returns the parsed content with token usage', async () => {
    mockParse.mockResolvedValue({
      parsed_output: {
        unmetRequirements: ['5+ years Kubernetes'],
        tailoredCv: 'Tailored CV text',
        coverLetter: 'Cover letter text',
        outreachMessage: 'Outreach text',
      },
      usage: { input_tokens: 4000, output_tokens: 1200 },
    })

    const { createClaudeMaterialsGenerator } = await import(
      '../../src/materials/materialsGenerator'
    )
    const generator = createClaudeMaterialsGenerator('test-api-key')

    const result = await generator({
      job: { title: 'Backend Engineer', company: 'Acme', rawDescription: 'We need Kubernetes experts.' },
      profile: {
        email: 'user@example.com',
        eligibility: { workAuthorization: 'citizen', countries: [] },
        preferences: { targetRoles: [], remoteOnly: true, minSalaryUsd: null, locations: [] },
        cvText: 'Experienced backend engineer.',
        resume: emptyResume(),
      },
      requirements: null,
    })

    expect(result.content.tailoredCv).toBe('Tailored CV text')
    expect(result.usage).toEqual({ inputTokens: 4000, outputTokens: 1200 })

    const callArgs = mockParse.mock.calls[0][0]
    expect(callArgs.model).toBe('claude-opus-4-8')
    expect(callArgs.messages[0].content).toContain('Experienced backend engineer.')
    expect(callArgs.messages[0].content).toContain('We need Kubernetes experts.')
  })

  it('throws if Claude returns no parsed output', async () => {
    mockParse.mockResolvedValue({
      parsed_output: null,
      usage: { input_tokens: 4000, output_tokens: 1200 },
    })

    const { createClaudeMaterialsGenerator } = await import(
      '../../src/materials/materialsGenerator'
    )
    const generator = createClaudeMaterialsGenerator('test-api-key')

    await expect(
      generator({
        job: { title: 'Engineer', company: 'Acme', rawDescription: 'desc' },
        profile: {
          email: 'user@example.com',
          eligibility: { workAuthorization: 'citizen', countries: [] },
          preferences: { targetRoles: [], remoteOnly: true, minSalaryUsd: null, locations: [] },
          cvText: null,
          resume: emptyResume(),
        },
        requirements: null,
      })
    ).rejects.toThrow('did not return parseable output')
  })
})
