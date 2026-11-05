import { describe, it, expect } from 'vitest'
import { createLlmConfig } from '../../src/llm/config'

describe('createLlmConfig', () => {
  it('defaults to anthropic with Claude models', () => {
    const config = createLlmConfig({ ANTHROPIC_API_KEY: 'k' })
    expect(config).not.toBeNull()
    expect(config!.providerName).toBe('anthropic')
    expect(config!.provider.name).toBe('anthropic')
    expect(config!.resume.model).toBe('claude-haiku-4-5')
    expect(config!.requirements.model).toBe('claude-haiku-4-5')
    expect(config!.materials.model).toBe('claude-opus-4-8')
    expect(config!.materials.reasoning).toBe(true)
  })

  it('selects openai with gpt-4o-mini for all capabilities', () => {
    const config = createLlmConfig({ LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'k' })
    expect(config!.providerName).toBe('openai')
    expect(config!.provider.name).toBe('openai')
    expect(config!.resume.model).toBe('gpt-4o-mini')
    expect(config!.materials.model).toBe('gpt-4o-mini')
    expect(config!.materials.reasoning).toBe(false)
  })

  it('selects gemini with gemini-2.0-flash and accepts GOOGLE_API_KEY', () => {
    const config = createLlmConfig({ LLM_PROVIDER: 'gemini', GOOGLE_API_KEY: 'k' })
    expect(config!.providerName).toBe('gemini')
    expect(config!.provider.name).toBe('gemini')
    expect(config!.resume.model).toBe('gemini-2.0-flash')
  })

  it('applies per-capability model overrides', () => {
    const config = createLlmConfig({
      LLM_PROVIDER: 'openai',
      OPENAI_API_KEY: 'k',
      LLM_MODEL_MATERIALS: 'gpt-4o',
    })
    expect(config!.materials.model).toBe('gpt-4o')
    expect(config!.resume.model).toBe('gpt-4o-mini')
  })

  it('returns null when the selected provider has no API key', () => {
    expect(createLlmConfig({ LLM_PROVIDER: 'openai' })).toBeNull()
    expect(createLlmConfig({})).toBeNull()
  })

  it('throws on an unknown provider', () => {
    expect(() => createLlmConfig({ LLM_PROVIDER: 'mistral', ANTHROPIC_API_KEY: 'k' })).toThrow(
      'Unknown LLM_PROVIDER'
    )
  })
})
