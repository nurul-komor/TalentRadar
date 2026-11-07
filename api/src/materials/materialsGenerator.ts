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

// Best-performing résumés quantify 75%+ of their bullets; ATS/recruiter checks
// penalize anything less. The prompt already demands this, but models sometimes
// under-deliver, so we measure the result and regenerate once if it falls short.
const QUANTIFIED_BULLET_THRESHOLD = 0.75

// Only Experience / Projects bullets are expected to carry impact numbers — the
// Skills/Education/Summary sections are not, so they're excluded from the ratio.
const IMPACT_SECTION_RE = /experience|work history|projects/i

// Walks the tailored-CV markdown and measures what fraction of the achievement
// bullets under the Experience/Projects sections contain a hard number. A bullet
// is any `- `/`* ` line (the bold `**Role — Company** (dates)` title lines are not
// bullets); "quantified" = contains a digit. Returns the weak (number-less)
// bullets so a retry can target them by name.
export function analyzeQuantification(tailoredCv: string): {
  total: number
  quantified: number
  ratio: number
  weakBullets: string[]
} {
  let inImpactSection = false
  let total = 0
  let quantified = 0
  const weakBullets: string[] = []

  for (const raw of tailoredCv.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim()
    const heading = /^#{1,6}\s+(.*)$/.exec(line)
    if (heading) {
      inImpactSection = IMPACT_SECTION_RE.test(heading[1])
      continue
    }
    if (!inImpactSection) continue
    if (!/^[-*]\s+/.test(line)) continue // skip title lines, blanks, context lines
    const text = line.replace(/^[-*]\s+/, '')
    total += 1
    if (/\d/.test(text)) quantified += 1
    else weakBullets.push(text.replace(/\*\*/g, '').trim())
  }

  return { total, quantified, ratio: total === 0 ? 1 : quantified / total, weakBullets }
}

// Counts the leading action verb of each Experience/Projects bullet and returns
// the ones that open more than two bullets — the overuse the ATS/recruiter check
// penalizes (e.g. "Developed" ×4). Same section scoping as analyzeQuantification.
export function analyzeActionVerbs(tailoredCv: string): {
  overused: Array<{ verb: string; count: number }>
} {
  let inImpactSection = false
  const counts = new Map<string, number>()

  for (const raw of tailoredCv.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim()
    const heading = /^#{1,6}\s+(.*)$/.exec(line)
    if (heading) {
      inImpactSection = IMPACT_SECTION_RE.test(heading[1])
      continue
    }
    if (!inImpactSection || !/^[-*]\s+/.test(line)) continue
    const first = line
      .replace(/^[-*]\s+/, '')
      .replace(/\*\*/g, '')
      .trim()
      .split(/\s+/)[0] ?? ''
    const verb = first.toLowerCase().replace(/[^a-z-]/g, '')
    if (!verb) continue
    counts.set(verb, (counts.get(verb) ?? 0) + 1)
  }

  const overused = [...counts.entries()]
    .filter(([, count]) => count > 2)
    .map(([verb, count]) => ({ verb, count }))
    .sort((a, b) => b.count - a.count)
  return { overused }
}

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

    const runOnce = (retryFeedback: Parameters<typeof buildMaterialsUserPrompt>[0]['retryFeedback']) =>
      provider.complete<GeneratedContent>({
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
          retryFeedback,
        }),
        schemaName: 'generated_content',
        jsonSchema: GENERATED_CONTENT_JSON_SCHEMA,
        parse: (content: string): GeneratedContent => GeneratedContentSchema.parse(JSON.parse(content)),
      })

    const first = await runOnce(null)
    let best = first.output
    const usage = { inputTokens: first.usage.inputTokens, outputTokens: first.usage.outputTokens }

    // Score a draft on both ATS signals: quantified-bullet ratio (higher better)
    // minus a penalty per action verb overused beyond twice. Used to decide
    // whether to regenerate, and which draft to keep.
    const score = (cv: string) =>
      analyzeQuantification(cv).ratio - 0.1 * analyzeActionVerbs(cv).overused.length

    // If the first draft is short on quantified bullets OR overuses an action
    // verb, regenerate once with targeted feedback and keep whichever draft
    // scores higher. One retry only, to cap latency/cost.
    const firstQuant = analyzeQuantification(first.output.tailoredCv)
    const firstVerbs = analyzeActionVerbs(first.output.tailoredCv)
    const needsRetry =
      (firstQuant.total > 0 && firstQuant.ratio < QUANTIFIED_BULLET_THRESHOLD) || firstVerbs.overused.length > 0
    if (needsRetry) {
      const second = await runOnce({
        previousRatioPct: Math.round(firstQuant.ratio * 100),
        weakBullets: firstQuant.weakBullets.slice(0, 20),
        overusedVerbs: firstVerbs.overused,
      })
      usage.inputTokens += second.usage.inputTokens
      usage.outputTokens += second.usage.outputTokens
      if (score(second.output.tailoredCv) >= score(first.output.tailoredCv)) best = second.output
    }

    return { content: best, model, usage }
  }
}
