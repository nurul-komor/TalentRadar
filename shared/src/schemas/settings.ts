import { z } from 'zod'

// Admin-managed runtime AI settings. Persisted as a single document in the `settings`
// collection (_id: 'ai') and merged over process.env at request time by the API's AI
// runtime, so an operator can configure providers/keys from the dashboard without an env
// change or redeploy. Secrets (API keys) are WRITE-ONLY from the client's perspective:
// they are accepted on update but never returned — the read shape exposes only whether a
// key is configured plus a non-reversible hint (last 4 chars).

export const LlmProviderSchema = z.enum(['anthropic', 'openai', 'gemini'])
export type LlmProviderName = z.infer<typeof LlmProviderSchema>

// How job/profile embeddings are generated:
// - 'ai'     → OpenAI embeddings API (needs openaiApiKey; 1536 dims by default)
// - 'manual' → local @huggingface/transformers model, no API key, runs in-process
export const EmbeddingModeSchema = z.enum(['ai', 'manual'])
export type EmbeddingMode = z.infer<typeof EmbeddingModeSchema>

// Per-capability model overrides. Empty/omitted falls back to the provider's default.
export const LlmModelOverridesSchema = z.object({
  resume: z.string().nullable().optional(),
  requirements: z.string().nullable().optional(),
  materials: z.string().nullable().optional(),
})
export type LlmModelOverrides = z.infer<typeof LlmModelOverridesSchema>

// The full stored document, secrets included. Server-side only — never sent to the client.
export const AiSettingsSchema = z.object({
  llmProvider: LlmProviderSchema,
  anthropicApiKey: z.string().nullable().optional(),
  openaiApiKey: z.string().nullable().optional(),
  geminiApiKey: z.string().nullable().optional(),
  models: LlmModelOverridesSchema.optional(),
  embeddingMode: EmbeddingModeSchema,
  // OpenAI model (ai mode) or HF model id (manual mode), e.g. 'Xenova/all-MiniLM-L6-v2'.
  embeddingModel: z.string(),
  embeddingDimensions: z.number().int().positive(),
  updatedAt: z.string().optional(),
  updatedBy: z.string().nullable().optional(),
})
export type AiSettings = z.infer<typeof AiSettingsSchema>

// What the client may send to update settings. Keys are optional strings: a non-empty
// string sets/replaces the key, null clears it, and omission leaves the stored key as-is.
export const AiSettingsUpdateSchema = z.object({
  llmProvider: LlmProviderSchema.optional(),
  anthropicApiKey: z.string().nullable().optional(),
  openaiApiKey: z.string().nullable().optional(),
  geminiApiKey: z.string().nullable().optional(),
  models: LlmModelOverridesSchema.optional(),
  embeddingMode: EmbeddingModeSchema.optional(),
  embeddingModel: z.string().optional(),
  embeddingDimensions: z.number().int().positive().optional(),
})
export type AiSettingsUpdate = z.infer<typeof AiSettingsUpdateSchema>

// A single key's configured status, safe to send to the client.
export const KeyStatusSchema = z.object({
  configured: z.boolean(),
  // Last 4 characters of the configured key, or null — just enough to recognize which
  // key is set without revealing it. 'env' when the value comes from the environment.
  hint: z.string().nullable(),
  source: z.enum(['db', 'env', 'none']),
})
export type KeyStatus = z.infer<typeof KeyStatusSchema>

// The read shape returned by GET /admin/settings/ai — no raw secrets.
export const AiSettingsViewSchema = z.object({
  llmProvider: LlmProviderSchema,
  keys: z.object({
    anthropic: KeyStatusSchema,
    openai: KeyStatusSchema,
    gemini: KeyStatusSchema,
  }),
  models: LlmModelOverridesSchema,
  embeddingMode: EmbeddingModeSchema,
  embeddingModel: z.string(),
  embeddingDimensions: z.number().int().positive(),
  // Whether the active LLM provider and the embedder are currently usable (a key is
  // present for the selected provider / the embedder could be constructed).
  llmReady: z.boolean(),
  embedderReady: z.boolean(),
  updatedAt: z.string().nullable(),
  updatedBy: z.string().nullable(),
})
export type AiSettingsView = z.infer<typeof AiSettingsViewSchema>
