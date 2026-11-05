import { describe, it, expect, vi, afterEach } from 'vitest'

const mockGenerate = vi.fn()

vi.mock('@google/genai', () => ({
  GoogleGenAI: class MockGoogleGenAI {
    models = { generateContent: mockGenerate }
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
    model: 'gemini-2.0-flash',
    system: 'system prompt',
    user: 'user content',
    maxOutputTokens: 512,
    schemaName: 'thing',
    jsonSchema: JSON_SCHEMA,
    parse: (raw: string) => JSON.parse(raw) as { value: string },
  }
}

describe('createGeminiProvider', () => {
  afterEach(() => mockGenerate.mockReset())

  it('calls generateContent with json mime + responseJsonSchema and parses + maps usage', async () => {
    mockGenerate.mockResolvedValue({
      text: '{"value":"ok"}',
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 },
    })
    const { createGeminiProvider } = await import('../../src/llm/geminiProvider')
    const provider = createGeminiProvider('test-key')

    const result = await provider.complete(baseRequest())

    expect(result.output).toEqual({ value: 'ok' })
    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 20 })

    const args = mockGenerate.mock.calls[0][0]
    expect(args.model).toBe('gemini-2.0-flash')
    expect(args.contents).toBe('user content')
    expect(args.config.systemInstruction).toBe('system prompt')
    expect(args.config.responseMimeType).toBe('application/json')
    expect(args.config.responseJsonSchema).toBe(JSON_SCHEMA)
    expect(args.config.maxOutputTokens).toBe(512)
  })

  it('throws when no text is returned', async () => {
    mockGenerate.mockResolvedValue({ text: '', usageMetadata: {} })
    const { createGeminiProvider } = await import('../../src/llm/geminiProvider')
    const provider = createGeminiProvider('test-key')

    await expect(provider.complete(baseRequest())).rejects.toThrow('did not return content')
  })
})
