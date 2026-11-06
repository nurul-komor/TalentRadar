import type { Db } from 'mongodb'
import type { AiSettings, AiSettingsView, KeyStatus } from '@job-hunter/shared'
import { createLlmConfig, createEmbeddingConfig, type LlmConfig } from '../llm/config.js'
import { createOpenAiEmbedder, type Embedder } from '../embeddings/embeddingProvider.js'
import { createLocalEmbedder } from '../embeddings/localEmbedder.js'
import { createResumeExtractor } from '../profile/resumeExtractor.js'
import { createRequirementsExtractor } from '../scoring/requirementsExtractor.js'
import { createMaterialsGenerator } from '../materials/materialsGenerator.js'
import { createJobPageExtractor } from '../userJobs/userJobsService.js'
import type { ResumeExtractor } from '../profile/types.js'
import type { JobRequirementsExtractor } from '../scoring/types.js'
import type { MaterialsGenerator } from '../materials/types.js'
import type { JobPageExtractor } from '../userJobs/userJobsService.js'
import { getAiSettings, defaultAiSettings } from '../settings/settingsService.js'

type Env = Record<string, string | undefined>

// A live, reloadable holder for everything AI-powered. The concrete providers/embedder and
// the capability extractors are rebuilt from DB settings (merged over process.env) whenever
// reload() is called — so an admin saving credentials in the dashboard takes effect without
// a redeploy. Route handlers read the current instance off this holder at request time and
// return 503 when the relevant piece is null (unconfigured), which is why the AI routes now
// mount unconditionally instead of being gated at startup.
export interface AiRuntime {
  llm: LlmConfig | null
  embedder: Embedder | null
  resumeExtractor: ResumeExtractor | null
  requirementsExtractor: JobRequirementsExtractor | null
  materialsGenerator: MaterialsGenerator | null
  jobPageExtractor: JobPageExtractor | null
  // The effective settings used to build the current instances (DB over env).
  settings: AiSettings
  reload(): Promise<void>
  // A secret-free view for the admin UI (key presence + source + last-4 hint, readiness).
  view(): AiSettingsView
}

// Produces the effective environment the LLM/embedding config builders consume: process.env
// with the stored settings layered on top (DB wins when a value is present).
function effectiveEnv(baseEnv: Env, settings: AiSettings): Env {
  const env: Env = { ...baseEnv }
  env.LLM_PROVIDER = settings.llmProvider
  if (settings.anthropicApiKey) env.ANTHROPIC_API_KEY = settings.anthropicApiKey
  if (settings.openaiApiKey) env.OPENAI_API_KEY = settings.openaiApiKey
  if (settings.geminiApiKey) env.GEMINI_API_KEY = settings.geminiApiKey
  if (settings.models?.resume) env.LLM_MODEL_RESUME = settings.models.resume
  if (settings.models?.requirements) env.LLM_MODEL_REQUIREMENTS = settings.models.requirements
  if (settings.models?.materials) env.LLM_MODEL_MATERIALS = settings.models.materials
  // For AI-mode embeddings, let the stored model/dimensions drive createEmbeddingConfig.
  if (settings.embeddingMode === 'ai') {
    env.EMBEDDINGS_MODEL = settings.embeddingModel
    env.EMBEDDINGS_DIMENSIONS = String(settings.embeddingDimensions)
  }
  return env
}

function last4(value: string | null | undefined): string | null {
  if (!value) return null
  return value.length <= 4 ? value : value.slice(-4)
}

// Describes where a provider key resolves from — stored settings take precedence over env.
function keyStatus(dbValue: string | null | undefined, envValue: string | undefined): KeyStatus {
  const db = dbValue?.trim()
  if (db) return { configured: true, hint: last4(db), source: 'db' }
  const env = envValue?.trim()
  if (env) return { configured: true, hint: last4(env), source: 'env' }
  return { configured: false, hint: null, source: 'none' }
}

export async function createAiRuntime(db: Db, baseEnv: Env = process.env): Promise<AiRuntime> {
  const runtime: AiRuntime = {
    llm: null,
    embedder: null,
    resumeExtractor: null,
    requirementsExtractor: null,
    materialsGenerator: null,
    jobPageExtractor: null,
    settings: defaultAiSettings(baseEnv),
    async reload() {
      const settings = (await getAiSettings(db)) ?? defaultAiSettings(baseEnv)
      runtime.settings = settings
      const env = effectiveEnv(baseEnv, settings)

      // --- LLM text capabilities ---
      const llm = createLlmConfig(env)
      runtime.llm = llm
      runtime.resumeExtractor = llm ? createResumeExtractor(llm.provider, llm.resume.model) : null
      runtime.requirementsExtractor = llm
        ? createRequirementsExtractor(llm.provider, llm.requirements.model)
        : null
      runtime.materialsGenerator = llm
        ? createMaterialsGenerator(llm.provider, llm.materials.model, llm.materials.reasoning)
        : null
      runtime.jobPageExtractor = llm
        ? createJobPageExtractor(llm.provider, llm.requirements.model)
        : null

      // --- Embeddings (ai = OpenAI API, manual = local HF model) ---
      if (settings.embeddingMode === 'manual') {
        runtime.embedder = createLocalEmbedder(settings.embeddingModel, settings.embeddingDimensions)
      } else {
        const embeddingConfig = createEmbeddingConfig(env)
        runtime.embedder = embeddingConfig
          ? createOpenAiEmbedder(embeddingConfig.apiKey, embeddingConfig.model, embeddingConfig.dimensions)
          : null
      }
    },
    view(): AiSettingsView {
      const s = runtime.settings
      return {
        llmProvider: s.llmProvider,
        keys: {
          anthropic: keyStatus(s.anthropicApiKey, baseEnv.ANTHROPIC_API_KEY),
          openai: keyStatus(s.openaiApiKey, baseEnv.OPENAI_API_KEY),
          gemini: keyStatus(s.geminiApiKey, baseEnv.GEMINI_API_KEY ?? baseEnv.GOOGLE_API_KEY),
        },
        models: s.models ?? {},
        embeddingMode: s.embeddingMode,
        embeddingModel: s.embeddingModel,
        embeddingDimensions: s.embeddingDimensions,
        llmReady: runtime.llm !== null,
        embedderReady: runtime.embedder !== null,
        updatedAt: s.updatedAt ?? null,
        updatedBy: s.updatedBy ?? null,
      }
    },
  }

  await runtime.reload()
  return runtime
}
