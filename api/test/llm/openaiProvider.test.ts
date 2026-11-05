import { describe, it, expect, vi, afterEach } from 'vitest'

const mockCreate = vi.fn()

vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = { completions: { create: mockCreate } }
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
    model: 'gpt-4o-mini',
    system: 'system prompt',
    user: 'user content',
    maxOutputTokens: 512,
    schemaName: 'thing',
    jsonSchema: JSON_SCHEMA,
    parse: (raw: string) => JSON.parse(raw) as { value: string },
  }
}

describe('createOpenaiProvider', () => {
  afterEach(() => mockCreate.mockReset())

  it('calls chat.completions.create with strict json_schema and parses + maps usage', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: '{"value":"ok"}', refusal: null } }],
      usage: { prompt_tokens: 100, completion_tokens: 20 },
    })
    const { createOpenaiProvider } = await import('../../src/llm/openaiProvider')
    const provider = createOpenaiProvider('test-key')

    const result = await provider.complete(baseRequest())

    expect(result.output).toEqual({ value: 'ok' })
    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 20 })

    const args = mockCreate.mock.calls[0][0]
    expect(args.model).toBe('gpt-4o-mini')
    expect(args.messages).toEqual([
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'user content' },
    ])
    expect(args.max_tokens).toBe(512)
    expect(args.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'thing', schema: JSON_SCHEMA, strict: true },
    })
  })

  it('throws on a refusal', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: null, refusal: 'cannot comply' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })
    const { createOpenaiProvider } = await import('../../src/llm/openaiProvider')
    const provider = createOpenaiProvider('test-key')

    await expect(provider.complete(baseRequest())).rejects.toThrow('refused')
  })

  it('throws when no content is returned', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: null, refusal: null } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })
    const { createOpenaiProvider } = await import('../../src/llm/openaiProvider')
    const provider = createOpenaiProvider('test-key')

    await expect(provider.complete(baseRequest())).rejects.toThrow('did not return content')
  })
})
