import { JobRequirementsSchema, type JobRequirements } from '@job-hunter/shared'
import type { LlmProvider } from '../llm/types.js'
import {
  REQUIREMENTS_EXTRACTION_SYSTEM_PROMPT,
  buildRequirementsExtractionUserPrompt,
} from '../llm/prompts.js'
import type { ExtractionResult, JobRequirementsExtractor } from './types'

// Deviation from the plan: `zodOutputFormat()` (the SDK helper the plan specified) builds its
// JSON Schema via Zod's `zod/v4` internals, but `JobRequirementsSchema` (shared/src/schemas/job.ts)
// is a Zod v3 schema — the two are not structurally compatible at runtime (zodOutputFormat throws
// "Cannot read properties of undefined (reading 'def')" when handed a v3 schema), and upgrading the
// whole shared package to Zod v4 is out of scope for this plan. Instead we hand-write the JSON Schema
// Claude needs for `output_config.format` and attach a `.parse()` that validates the real response
// through `JobRequirementsSchema` — this still satisfies the design-spec requirement ("schema-validated
// structured output, never parsed from free-text") using the same schema the rest of the app trusts.
const JOB_REQUIREMENTS_JSON_SCHEMA = {
  type: 'object',
  properties: {
    requiredSkills: { type: 'array', items: { type: 'string' } },
    niceToHaveSkills: { type: 'array', items: { type: 'string' } },
    minExperienceYears: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
    workAuthRequirement: {
      type: 'string',
      enum: ['any', 'citizen_only', 'visa_sponsorship_available', 'unknown'],
    },
    remoteType: {
      type: 'string',
      enum: ['fully_remote', 'hybrid', 'onsite', 'unknown'],
    },
  },
  required: [
    'requiredSkills',
    'niceToHaveSkills',
    'minExperienceYears',
    'workAuthRequirement',
    'remoteType',
  ],
  additionalProperties: false,
} satisfies Record<string, unknown>

// Provider-agnostic: the configured provider (Anthropic / OpenAI) and model are injected,
// so this capability only owns the prompt + schema, not the SDK.
export function createRequirementsExtractor(
  provider: LlmProvider,
  model: string
): JobRequirementsExtractor {
  return async ({ title, company, rawDescription }): Promise<ExtractionResult> => {
    const { output, usage } = await provider.complete<JobRequirements>({
      model,
      maxOutputTokens: 1024,
      system: REQUIREMENTS_EXTRACTION_SYSTEM_PROMPT,
      user: buildRequirementsExtractionUserPrompt({ title, company, rawDescription }),
      schemaName: 'job_requirements',
      jsonSchema: JOB_REQUIREMENTS_JSON_SCHEMA,
      parse: (content: string): JobRequirements => JobRequirementsSchema.parse(JSON.parse(content)),
    })

    return { requirements: output, model, usage }
  }
}
