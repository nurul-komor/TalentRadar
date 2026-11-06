import type { Db } from 'mongodb'
import {
  AiSettingsSchema,
  type AiSettings,
  type AiSettingsUpdate,
  type LlmProviderName,
} from '@job-hunter/shared'
import { DEFAULT_LOCAL_EMBEDDING_MODEL, localEmbeddingDimensions } from '../embeddings/localEmbedder.js'

// Persistence for the admin-managed AI settings document. A single document in the
// `settings` collection (_id: 'ai') holds the runtime overrides; the AI runtime merges
// it over process.env. Keeping this thin (just load/merge/store) means the runtime owns
// all of the "how does this translate into providers/embedders" logic.

const SETTINGS_COLLECTION = 'settings'
const AI_SETTINGS_ID = 'ai'

type Env = Record<string, string | undefined>

// The starting point when no settings document exists yet: derive sensible defaults from
// the environment so an operator who has only ever used env vars sees their current setup
// reflected, and the embedding defaults match the historical OpenAI behavior.
export function defaultAiSettings(env: Env): AiSettings {
  const rawProvider = (env.LLM_PROVIDER ?? 'anthropic').trim().toLowerCase()
  const llmProvider: LlmProviderName =
    rawProvider === 'openai' ? 'openai' : rawProvider === 'gemini' || rawProvider === 'google' ? 'gemini' : 'anthropic'

  return {
    llmProvider,
    anthropicApiKey: null,
    openaiApiKey: null,
    geminiApiKey: null,
    models: {
      resume: env.LLM_MODEL_RESUME?.trim() || undefined,
      requirements: env.LLM_MODEL_REQUIREMENTS?.trim() || undefined,
      materials: env.LLM_MODEL_MATERIALS?.trim() || undefined,
    },
    embeddingMode: 'ai',
    embeddingModel: env.EMBEDDINGS_MODEL?.trim() || 'text-embedding-3-small',
    embeddingDimensions: Number.parseInt(env.EMBEDDINGS_DIMENSIONS?.trim() || '1536', 10),
  }
}

// Loads the stored AI settings, or null when none has been saved yet.
export async function getAiSettings(db: Db): Promise<AiSettings | null> {
  const doc = await db.collection(SETTINGS_COLLECTION).findOne({ _id: AI_SETTINGS_ID as never })
  if (!doc) return null
  const { _id, ...rest } = doc
  const parsed = AiSettingsSchema.safeParse(rest)
  return parsed.success ? parsed.data : null
}

// Returns the effective settings: the stored document if present, else env-derived defaults.
export async function getEffectiveAiSettings(db: Db, env: Env): Promise<AiSettings> {
  return (await getAiSettings(db)) ?? defaultAiSettings(env)
}

// Normalizes a client-supplied key value: trims, strips surrounding quotes. Empty → null
// (treated as "clear"). This mirrors the hardening in llm/config so a key pasted with a
// trailing newline doesn't surface later as a confusing 401.
function normalizeKey(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  const cleaned = value.trim().replace(/^["']|["']$/g, '')
  return cleaned === '' ? null : cleaned
}

// Applies a partial update to the stored settings and returns the merged result.
// Field semantics: a provided string sets the value, null clears it, omission leaves the
// existing value untouched. `embeddingMode` switching to 'manual' with no explicit model
// defaults the model/dimensions to the local default so the caller never ends up with a
// mode/model mismatch.
export async function updateAiSettings(
  db: Db,
  env: Env,
  update: AiSettingsUpdate,
  updatedBy: string | null,
  nowIso: string
): Promise<AiSettings> {
  const current = await getEffectiveAiSettings(db, env)

  const next: AiSettings = {
    ...current,
    llmProvider: update.llmProvider ?? current.llmProvider,
    models: update.models ? { ...current.models, ...update.models } : current.models,
    embeddingMode: update.embeddingMode ?? current.embeddingMode,
    embeddingModel: update.embeddingModel ?? current.embeddingModel,
    embeddingDimensions: update.embeddingDimensions ?? current.embeddingDimensions,
    updatedAt: nowIso,
    updatedBy,
  }

  // Keys: undefined = leave, null = clear, string = set (after normalization).
  const anthropic = normalizeKey(update.anthropicApiKey)
  const openai = normalizeKey(update.openaiApiKey)
  const gemini = normalizeKey(update.geminiApiKey)
  if (anthropic !== undefined) next.anthropicApiKey = anthropic
  if (openai !== undefined) next.openaiApiKey = openai
  if (gemini !== undefined) next.geminiApiKey = gemini

  // When the operator flips to manual mode without naming a model, pick the local default
  // and its known dimensionality so the embedder is immediately usable.
  if (update.embeddingMode === 'manual' && update.embeddingModel === undefined && current.embeddingMode !== 'manual') {
    next.embeddingModel = DEFAULT_LOCAL_EMBEDDING_MODEL
    next.embeddingDimensions = localEmbeddingDimensions(DEFAULT_LOCAL_EMBEDDING_MODEL)
  }
  // A manual model change with no explicit dimensions re-derives the known dimensionality.
  if (next.embeddingMode === 'manual' && update.embeddingModel !== undefined && update.embeddingDimensions === undefined) {
    next.embeddingDimensions = localEmbeddingDimensions(next.embeddingModel)
  }

  await db
    .collection(SETTINGS_COLLECTION)
    .updateOne({ _id: AI_SETTINGS_ID as never }, { $set: next }, { upsert: true })

  return next
}
