import { ResumeSchema, type Resume } from '@job-hunter/shared'
import type { LlmProvider } from '../llm/types.js'
import { RESUME_EXTRACTION_SYSTEM_PROMPT, buildResumeExtractionUserPrompt } from '../llm/prompts.js'
import type { ResumeExtractionResult, ResumeExtractor } from './types.js'

// Same deviation as scoring/requirementsExtractor.ts and materials/materialsGenerator.ts:
// `zodOutputFormat()` requires a Zod v4 schema, but `ResumeSchema` is Zod v3 — hand-write the
// JSON Schema and validate the real response through `ResumeSchema.parse()`.
const RESUME_JSON_SCHEMA = {
  type: 'object',
  properties: {
    fullName: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    headline: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    phone: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    links: { type: 'array', items: { type: 'string' } },
    summary: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    experience: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          company: { type: 'string' },
          role: { type: 'string' },
          startDate: { type: 'string' },
          endDate: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          bullets: { type: 'array', items: { type: 'string' } },
        },
        required: ['company', 'role', 'startDate', 'endDate', 'bullets'],
        additionalProperties: false,
      },
    },
    projects: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          url: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          role: { type: 'string' },
          technologies: { type: 'array', items: { type: 'string' } },
          bullets: { type: 'array', items: { type: 'string' } },
        },
        required: ['name', 'url', 'role', 'technologies', 'bullets'],
        additionalProperties: false,
      },
    },
    skillGroups: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          category: { type: 'string' },
          skills: { type: 'array', items: { type: 'string' } },
        },
        required: ['category', 'skills'],
        additionalProperties: false,
      },
    },
    education: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          institution: { type: 'string' },
          credential: { type: 'string' },
        },
        required: ['institution', 'credential'],
        additionalProperties: false,
      },
    },
  },
  required: ['fullName', 'headline', 'phone', 'links', 'summary', 'experience', 'projects', 'skillGroups', 'education'],
  additionalProperties: false,
} satisfies Record<string, unknown>

// Provider-agnostic: the configured provider (Anthropic / OpenAI) and model are injected,
// so this capability only owns the prompt + schema, not the SDK.
export function createResumeExtractor(provider: LlmProvider, model: string): ResumeExtractor {
  return async (cvText: string): Promise<ResumeExtractionResult> => {
    const { output, usage } = await provider.complete<Resume>({
      model,
      maxOutputTokens: 2048,
      system: RESUME_EXTRACTION_SYSTEM_PROMPT,
      user: buildResumeExtractionUserPrompt(cvText),
      schemaName: 'resume',
      jsonSchema: RESUME_JSON_SCHEMA,
      parse: (content: string): Resume => ResumeSchema.parse(JSON.parse(content)),
    })

    return { resume: output, model, usage }
  }
}
