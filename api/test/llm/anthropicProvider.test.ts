import { describe, it, expect, vi, afterEach } from 'vitest'

const mockParse = vi.fn()

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { parse: mockParse }
  },
}))

const JSON_SCHEMA = {
  type: 'object',
  properties: { value: { type: 'string' } },
  required: ['value'],
  additionalProperties: false,
}

function baseRequest() {
  return {
    model: 'claude-haiku-4-5',
    system: 'system prompt',
    user: 'user content',
    maxOutputTokens: 512,
    schemaName: 'thing',
    jsonSchema: JSON_SCHEMA,
    parse: (raw: string) => JSON.parse(raw) as { value: string },
  }
}

describe('createAnthropicProvider', () => {
  afterEach(() => mockParse.mockReset())

  it('calls messages.parse with the schema format and maps parsed_output + usage', async () => {
    mockParse.mockResolvedValue({
      parsed_output: { value: 'ok' },
      usage: { input_tokens: 100, output_tokens: 20 },
    })
    const { createAnthropicProvider } = await import('../../src/llm/anthropicProvider')
    const provider = createAnthropicProvider('test-key')

    const result = await provider.complete(baseRequest())

    expect(result.output).toEqual({ value: 'ok' })
    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 20 })

    const args = mockParse.mock.calls[0][0]
    expect(args.model).toBe('claude-haiku-4-5')
    expect(args.system).toBe('system prompt')
    expect(args.messages[0].content).toBe('user content')
    expect(args.max_tokens).toBe(512)
    expect(args.output_config.format.schema).toBe(JSON_SCHEMA)
    expect(args.thinking).toBeUndefined()
  })

  it('enables adaptive thinking when reasoning is requested', async () => {
    mockParse.mockResolvedValue({
      parsed_output: { value: 'ok' },
      usage: { input_tokens: 1, output_tokens: 1 },
    })
    const { createAnthropicProvider } = await import('../../src/llm/anthropicProvider')
    const provider = createAnthropicProvider('test-key')

    await provider.complete({ ...baseRequest(), reasoning: true })

    expect(mockParse.mock.calls[0][0].thinking).toEqual({ type: 'adaptive' })
  })

  it('throws when no parseable output is returned', async () => {
    mockParse.mockResolvedValue({ parsed_output: null, usage: { input_tokens: 1, output_tokens: 1 } })
    const { createAnthropicProvider } = await import('../../src/llm/anthropicProvider')
    const provider = createAnthropicProvider('test-key')

    await expect(provider.complete(baseRequest())).rejects.toThrow('did not return parseable output')
  })
})
