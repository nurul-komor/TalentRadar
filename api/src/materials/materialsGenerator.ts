import { GeneratedContentSchema, type GeneratedContent } from '@job-hunter/shared'
import type { LlmProvider } from '../llm/types.js'
import { MATERIALS_SYSTEM_PROMPT, buildMaterialsUserPrompt } from '../llm/prompts.js'
import { computeMissingSkills } from './materialsService.js'
import type { GenerationResult, MaterialsGenerator } from './types'

// Deviation from the plan (same precedent as M3b's requirementsExtractor.ts): `zodOutputFormat()`
// builds its JSON Schema via Zod's `zod/v4` internals, but `GeneratedContentSchema`
// (shared/src/schemas/materials.ts) is a Zod v3 schema — the two are not structurally compatible
// at runtime (zodOutputFormat throws "Cannot read properties of undefined (reading 'def')" when
// handed a v3 schema). Instead we hand-write the JSON Schema Claude needs for `output_config.format`
// and attach a `.parse()` that validates the real response through `GeneratedContentSchema` — this
// still satisfies "schema-validated structured output" using the same schema the rest of the app trusts.
const GENERATED_CONTENT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    unmetRequirements: { type: 'array', items: { type: 'string' } },
    tailoredCv: { type: 'string' },
    coverLetter: { type: 'string' },
    outreachMessage: { type: 'string' },
  },
  required: ['unmetRequirements', 'tailoredCv', 'coverLetter', 'outreachMessage'],
  additionalProperties: false,
} satisfies Record<string, unknown>

// Provider-agnostic: the configured provider (Anthropic / OpenAI) and model are injected.
// `reasoning` asks for extended thinking when the selected model supports it (e.g. Claude
// Opus); providers whose model has no reasoning mode (e.g. gpt-4o-mini) ignore it.
export function createMaterialsGenerator(
  provider: LlmProvider,
  model: string,
  reasoning: boolean
): MaterialsGenerator {
  return async ({ job, profile, requirements }): Promise<GenerationResult> => {
    const requirementsSummary = requirements
      ? `Required skills: ${requirements.requiredSkills.join(', ') || 'none listed'}\n` +
        `Nice-to-have skills: ${requirements.niceToHaveSkills.join(', ') || 'none listed'}\n` +
        `Minimum experience: ${requirements.minExperienceYears ?? 'not specified'} years\n` +
        `Work authorization: ${requirements.workAuthRequirement}\n` +
        `Remote type: ${requirements.remoteType}`
      : 'No structured requirements were extracted for this job; rely on the posting text below.'

    const missingSkills = computeMissingSkills(profile, requirements?.requiredSkills ?? [])

    // Authoritative contact details from the structured résumé — passed so the
    // header (especially the location, which the ATS checks for) is reliable even
    // when the parsed cvText is messy or omits it.
    const resume = profile.resume
    const contact = {
      fullName: resume?.fullName ?? null,
      email: profile.email ?? null,
      phone: resume?.phone ?? null,
      city: resume?.location?.city ?? null,
      country: resume?.location?.country ?? null,
      linkedin: resume?.linkedin ?? null,
      github: resume?.github ?? null,
    }

    const { output, usage } = await provider.complete<GeneratedContent>({
      model,
      maxOutputTokens: 12000,
      reasoning,
      system: MATERIALS_SYSTEM_PROMPT,
      user: buildMaterialsUserPrompt({
        cvText: profile.cvText ?? null,
        jobTitle: job.title,
        company: job.company,
        requirementsSummary,
        rawDescription: job.rawDescription,
        missingSkills,
        contact,
      }),
      schemaName: 'generated_content',
      jsonSchema: GENERATED_CONTENT_JSON_SCHEMA,
      parse: (content: string): GeneratedContent => GeneratedContentSchema.parse(JSON.parse(content)),
    })

    return { content: output, model, usage }
  }
}
