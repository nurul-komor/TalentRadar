import type { LlmProvider, ProviderName } from './types.js'
import { createAnthropicProvider } from './anthropicProvider.js'
import { createOpenaiProvider } from './openaiProvider.js'
import { createGeminiProvider } from './geminiProvider.js'

export type Capability = 'resume' | 'requirements' | 'materials'

export interface CapabilityConfig {
  model: string
  // Request extended thinking / reasoning for this capability (only honored by
  // providers whose selected model supports it).
  reasoning: boolean
}

export interface LlmConfig {
  providerName: ProviderName
  provider: LlmProvider
  resume: CapabilityConfig
  requirements: CapabilityConfig
  materials: CapabilityConfig
}

// Per-provider default model for each capability. Extraction uses a fast/cheap model;
// materials uses a stronger model (and, on Anthropic, extended thinking). Any of these
// can be overridden per capability with LLM_MODEL_* env vars (see resolveModel).
const DEFAULTS: Record<ProviderName, Record<Capability, CapabilityConfig>> = {
  anthropic: {
    resume: { model: 'claude-haiku-4-5', reasoning: false },
    requirements: { model: 'claude-haiku-4-5', reasoning: false },
    materials: { model: 'claude-opus-4-8', reasoning: true },
  },
  openai: {
    resume: { model: 'gpt-4o-mini', reasoning: false },
    requirements: { model: 'gpt-4o-mini', reasoning: false },
    // gpt-4o-mini has no reasoning mode, so materials runs without extended thinking.
    materials: { model: 'gpt-4o-mini', reasoning: false },
  },
  gemini: {
    resume: { model: 'gemini-2.0-flash', reasoning: false },
    requirements: { model: 'gemini-2.0-flash', reasoning: false },
    materials: { model: 'gemini-2.0-flash', reasoning: false },
  },
}

const MODEL_OVERRIDE_ENV: Record<Capability, string> = {
  resume: 'LLM_MODEL_RESUME',
  requirements: 'LLM_MODEL_REQUIREMENTS',
  materials: 'LLM_MODEL_MATERIALS',
}

type Env = Record<string, string | undefined>

function resolveProviderName(env: Env): ProviderName {
  const raw = (env.LLM_PROVIDER ?? 'anthropic').trim().toLowerCase()
  if (raw === 'openai') return 'openai'
  if (raw === 'anthropic') return 'anthropic'
  if (raw === 'gemini' || raw === 'google') return 'gemini'
  throw new Error(
    `Unknown LLM_PROVIDER "${env.LLM_PROVIDER}". Expected "anthropic", "openai", or "gemini".`
  )
}

function resolveCapability(env: Env, provider: ProviderName, capability: Capability): CapabilityConfig {
  const base = DEFAULTS[provider][capability]
  const override = env[MODEL_OVERRIDE_ENV[capability]]?.trim()
  return override ? { ...base, model: override } : base
}

// Builds the active LLM configuration from the environment, or returns null when the
// selected provider has no API key configured — letting the caller disable the AI
// routes exactly as it did before (see mountRoutes).
export function createLlmConfig(env: Env): LlmConfig | null {
  const providerName = resolveProviderName(env)

  const rawApiKey =
    providerName === 'openai'
      ? env.OPENAI_API_KEY
      : providerName === 'gemini'
        ? env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY
        : env.ANTHROPIC_API_KEY
  // Guard against a secret pasted with a trailing newline or surrounding quotes —
  // the provider SDK sends the key verbatim as a bearer token, so stray whitespace
  // surfaces as a confusing 401 "Invalid bearer token" at call time.
  const apiKey = rawApiKey?.trim().replace(/^["']|["']$/g, '')
  if (!apiKey) return null

  const provider =
    providerName === 'openai'
      ? createOpenaiProvider(apiKey)
      : providerName === 'gemini'
        ? createGeminiProvider(apiKey)
        : createAnthropicProvider(apiKey)

  return {
    providerName,
    provider,
    resume: resolveCapability(env, providerName, 'resume'),
    requirements: resolveCapability(env, providerName, 'requirements'),
    materials: resolveCapability(env, providerName, 'materials'),
  }
}
