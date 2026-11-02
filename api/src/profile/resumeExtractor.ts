import Anthropic from '@anthropic-ai/sdk'
import { ResumeSchema, type Resume } from '@job-hunter/shared'
import type { ResumeExtractionResult, ResumeExtractor } from './types.js'

const SYSTEM_PROMPT = `You extract a structured resume from a candidate's CV text.

Extract only what the CV text actually states. If a field isn't mentioned, use null (for fullName/headline/phone/summary) or an empty array (for links/experience/projects/skillGroups/education) — never guess or invent experience, dates, or credentials the CV doesn't show.`

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

const resumeOutputFormat = {
  type: 'json_schema' as const,
  schema: RESUME_JSON_SCHEMA,
  parse: (content: string): Resume => ResumeSchema.parse(JSON.parse(content)),
}

export function createClaudeResumeExtractor(apiKey: string): ResumeExtractor {
  const client = new Anthropic({ apiKey })

  return async (cvText: string): Promise<ResumeExtractionResult> => {
    const response = await client.messages.parse({
      model: 'claude-haiku-4-5',
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `CV text:\n${cvText}` }],
      output_config: {
        format: resumeOutputFormat,
      },
    })

    if (!response.parsed_output) {
      throw new Error('Claude did not return parseable output for this CV')
    }

    return {
      resume: response.parsed_output,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    }
  }
}
