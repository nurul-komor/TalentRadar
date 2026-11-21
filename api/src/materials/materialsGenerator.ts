import { GeneratedContentSchema, type GeneratedContent } from '@job-hunter/shared'
import type { LlmProvider } from '../llm/types.js'
import {
  MATERIALS_SYSTEM_PROMPT,
  buildMaterialsUserPrompt,
  SKILL_AUDIT_SYSTEM_PROMPT,
  buildSkillAuditUserPrompt,
} from '../llm/prompts.js'
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

// The ATS readability check flags any text block longer than this.
const MAX_BLOCK_WORDS = 40

// Measures the two formatting signals the ATS readability check scores: text
// blocks over 40 words, and bold used outside the Experience/Projects title
// lines. Bold is only legitimate on a title line (`**Role — Company**` /
// `**Project Name**`); anywhere else — inside a bullet, around a metric, on a
// Skills label, in the Summary — it reads as "too much bold styling".
export function analyzeReadability(tailoredCv: string): {
  longBlocks: string[]
  strayBold: string[]
} {
  const longBlocks: string[] = []
  const strayBold: string[] = []

  for (const raw of tailoredCv.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim()
    if (!line || /^#{1,6}\s+/.test(line)) continue // headings are not prose blocks

    const isBullet = /^[-*]\s+/.test(line)
    const text = line.replace(/^[-*]\s+/, '')
    // A title line is a non-bullet line that opens with bold — the one place
    // bold belongs. Everything else is a bullet or prose.
    const isTitleLine = !isBullet && /^\*\*/.test(text)

    const plain = text.replace(/\*\*/g, '').trim()
    if (plain.split(/\s+/).filter(Boolean).length > MAX_BLOCK_WORDS) longBlocks.push(plain)

    if (!isTitleLine) {
      for (const [, inner] of text.matchAll(/\*\*(.+?)\*\*/g)) strayBold.push(inner.trim())
    }
  }

  return { longBlocks, strayBold }
}

// Normalizes résumé / skill text so a literal keyword check isn't defeated by
// casing or punctuation — "Express.js" must match "Express js", "Aws services"
// must match "AWS Services". Every non-alphanumeric run collapses to a single
// space, and the result is padded so callers can boundary-match with a plain
// `includes` (" express js " won't match inside "expressive").
function normalizeForMatch(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `
}

// The ATS matches posting keywords literally: a skill the résumé never spells out
// scores as a miss no matter how strongly the surrounding bullets imply it. The
// prompt demands 100% coverage, but models reliably drop terms they consider
// unsupported, generic, or redundant — so we measure it. Returns the skills
// absent from the generated CV, in the order the posting asked for them, so a
// retry can name each one exactly.
export function analyzeSkillCoverage(
  tailoredCv: string,
  skills: string[]
): { missing: string[]; covered: number; total: number } {
  const haystack = normalizeForMatch(tailoredCv)
  const seen = new Set<string>()
  const missing: string[] = []
  let total = 0

  for (const skill of skills) {
    const needle = normalizeForMatch(skill)
    // Skills that normalize to a single character (e.g. "C++" → "c", "R" → "r")
    // would match almost any résumé, so they're skipped rather than scored as
    // false hits — a 1-char keyword isn't a reliable ATS signal either way.
    if (needle.trim().length < 2 || seen.has(needle)) continue
    seen.add(needle)
    total += 1
    if (!haystack.includes(needle)) missing.push(skill.trim())
  }

  return { missing, covered: total - missing.length, total }
}

// Last-resort guarantee for the coverage floor: after the retry, any posting
// skill the model STILL omitted is appended verbatim to the `## Skills` section.
// Safe to do mechanically precisely because Skills is a coverage index rather
// than a claim of experience (see MATERIALS_SYSTEM_PROMPT) — the work history,
// which must stay strictly truthful, is never touched. Falls back to appending a
// Skills section when the draft somehow has none.
export function backfillMissingSkills(tailoredCv: string, missing: string[]): string {
  if (missing.length === 0) return tailoredCv

  // Split across several bullets rather than one sprawling line: a single line
  // of 50 backfilled skills would trip the >40-word readability check that
  // analyzeReadability measures. Only the first carries the label.
  const added: string[] = []
  let chunk: string[] = []
  let words = 0
  for (const skill of missing) {
    const skillWords = skill.split(/\s+/).filter(Boolean).length
    if (chunk.length > 0 && words + skillWords > MAX_BLOCK_WORDS - 2) {
      added.push(chunk.join(', '))
      chunk = []
      words = 0
    }
    chunk.push(skill)
    words += skillWords
  }
  if (chunk.length > 0) added.push(chunk.join(', '))
  const newLines = added.map((group, i) => (i === 0 ? `- Additional Skills: ${group}` : `- ${group}`))

  const lines = tailoredCv.replace(/\r\n/g, '\n').split('\n')
  const start = lines.findIndex((l) => /^#{1,6}\s+skills\b/i.test(l.trim()))
  if (start === -1) return `${tailoredCv.trimEnd()}\n\n## Skills\n${newLines.join('\n')}\n`

  // Walk to the next heading (or EOF), then back up over trailing blank lines so
  // the added lines sit with the existing skill bullets rather than after a gap.
  let insertAt = start + 1
  while (insertAt < lines.length && !/^#{1,6}\s+/.test(lines[insertAt].trim())) insertAt += 1
  while (insertAt > start + 1 && lines[insertAt - 1].trim() === '') insertAt -= 1

  lines.splice(insertAt, 0, ...newLines)
  return lines.join('\n')
}

const SKILL_AUDIT_JSON_SCHEMA = {
  type: 'object',
  properties: { missingSkills: { type: 'array', items: { type: 'string' } } },
  required: ['missingSkills'],
  additionalProperties: false,
} satisfies Record<string, unknown>

// Provider-agnostic: the configured provider (Anthropic / OpenAI) and model are injected.
// `reasoning` asks for extended thinking when the selected model supports it (e.g. Claude
// Opus); providers whose model has no reasoning mode (e.g. gpt-4o-mini) ignore it.
//
// `auditModel` (optional) enables the final keyword-coverage audit: a cheap second
// model re-reads the RAW posting against the finished résumé and reports skills the
// requirements extractor never surfaced. Without it, coverage can only ever be as
// complete as the extracted requirements list. Omit to disable the pass entirely.
export function createMaterialsGenerator(
  provider: LlmProvider,
  model: string,
  reasoning: boolean,
  auditModel?: string | null
): MaterialsGenerator {
  return async ({ job, profile, requirements }): Promise<GenerationResult> => {
    const softSkills = requirements?.softSkills ?? []
    const requirementsSummary = requirements
      ? `Required skills: ${requirements.requiredSkills.join(', ') || 'none listed'}\n` +
        `Nice-to-have skills: ${requirements.niceToHaveSkills.join(', ') || 'none listed'}\n` +
        `Soft skills: ${softSkills.join(', ') || 'none listed'}\n` +
        `Minimum experience: ${requirements.minExperienceYears ?? 'not specified'} years\n` +
        `Work authorization: ${requirements.workAuthRequirement}\n` +
        `Remote type: ${requirements.remoteType}`
      : 'No structured requirements were extracted for this job; rely on the posting text below.'

    // Force-add every stated hard skill the master CV lacks — required AND
    // nice-to-have — so the résumé covers the role's keywords for the ATS.
    const missingSkills = computeMissingSkills(profile, [
      ...(requirements?.requiredSkills ?? []),
      ...(requirements?.niceToHaveSkills ?? []),
    ])

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
          softSkills,
          contact,
          retryFeedback,
        }),
        schemaName: 'generated_content',
        jsonSchema: GENERATED_CONTENT_JSON_SCHEMA,
        parse: (content: string): GeneratedContent => GeneratedContentSchema.parse(JSON.parse(content)),
      })

    // Every keyword the ATS will score the résumé against: the posting's hard
    // skills (required + nice-to-have) plus its soft skills. Unlike
    // `missingSkills` — which is only what the PROFILE lacks — this is the full
    // list the finished CV must spell out, since a skill the candidate holds
    // still scores as a miss when the résumé never names it.
    const postingKeywords = [
      ...(requirements?.requiredSkills ?? []),
      ...(requirements?.niceToHaveSkills ?? []),
      ...softSkills,
    ]

    const first = await runOnce(null)
    let best = first.output
    const usage = { inputTokens: first.usage.inputTokens, outputTokens: first.usage.outputTokens }

    // Score a draft on all three ATS signals: keyword coverage (weighted double —
    // the scan rates hard skills "high impact" and a missed keyword can drop the
    // résumé from the search entirely), plus the quantified-bullet ratio, minus a
    // penalty per action verb overused beyond twice.
    const score = (cv: string) => {
      const coverage = analyzeSkillCoverage(cv, postingKeywords)
      const coverageRatio = coverage.total === 0 ? 1 : coverage.covered / coverage.total
      const readability = analyzeReadability(cv)
      return (
        2 * coverageRatio +
        analyzeQuantification(cv).ratio -
        0.1 * analyzeActionVerbs(cv).overused.length -
        0.05 * (readability.longBlocks.length + readability.strayBold.length)
      )
    }

    // If the first draft misses posting keywords, is short on quantified bullets,
    // OR overuses an action verb, regenerate once with targeted feedback and keep
    // whichever draft scores higher. One retry only, to cap latency/cost.
    const firstQuant = analyzeQuantification(first.output.tailoredCv)
    const firstVerbs = analyzeActionVerbs(first.output.tailoredCv)
    const firstCoverage = analyzeSkillCoverage(first.output.tailoredCv, postingKeywords)
    const firstRead = analyzeReadability(first.output.tailoredCv)
    const needsRetry =
      firstCoverage.missing.length > 0 ||
      (firstQuant.total > 0 && firstQuant.ratio < QUANTIFIED_BULLET_THRESHOLD) ||
      firstVerbs.overused.length > 0 ||
      firstRead.longBlocks.length > 0 ||
      firstRead.strayBold.length > 0
    if (needsRetry) {
      const second = await runOnce({
        previousRatioPct: Math.round(firstQuant.ratio * 100),
        weakBullets: firstQuant.weakBullets.slice(0, 20),
        overusedVerbs: firstVerbs.overused,
        missingKeywords: firstCoverage.missing,
        longBlocks: firstRead.longBlocks.slice(0, 15),
        strayBold: firstRead.strayBold.slice(0, 20),
      })
      usage.inputTokens += second.usage.inputTokens
      usage.outputTokens += second.usage.outputTokens
      if (score(second.output.tailoredCv) >= score(first.output.tailoredCv)) best = second.output
    }

    // `postingKeywords` can only ever be as complete as the requirements
    // extractor was — a skill it never pulled out of the posting is invisible to
    // the coverage check above. So re-scan the RAW posting against the finished
    // résumé with a cheap model, which catches exactly those. Best-effort: an
    // audit failure must never cost the user their generated materials.
    let auditMissing: string[] = []
    if (auditModel) {
      try {
        const audit = await provider.complete<{ missingSkills: string[] }>({
          model: auditModel,
          maxOutputTokens: 2000,
          reasoning: false,
          system: SKILL_AUDIT_SYSTEM_PROMPT,
          user: buildSkillAuditUserPrompt({
            postingText: job.rawDescription,
            resumeText: best.tailoredCv,
          }),
          schemaName: 'skill_audit',
          jsonSchema: SKILL_AUDIT_JSON_SCHEMA,
          parse: (content: string) => {
            const parsed: unknown = JSON.parse(content)
            const raw =
              typeof parsed === 'object' && parsed !== null
                ? (parsed as { missingSkills?: unknown }).missingSkills
                : null
            return {
              missingSkills: Array.isArray(raw)
                ? raw.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
                : [],
            }
          },
        })
        usage.inputTokens += audit.usage.inputTokens
        usage.outputTokens += audit.usage.outputTokens
        auditMissing = audit.output.missingSkills
      } catch {
        // Fall through with whatever the deterministic check found.
      }
    }

    // Guarantee the coverage floor the prompt asks for: whatever is still absent
    // — from the extracted requirements OR from the auditor's read of the raw
    // posting — gets appended to `## Skills` verbatim. Only the Skills index is
    // touched, never the work history. Re-running the deterministic check over
    // the combined list drops any term the auditor wrongly flagged as missing.
    const stillMissing = analyzeSkillCoverage(best.tailoredCv, [
      ...postingKeywords,
      ...auditMissing,
    ]).missing
    if (stillMissing.length > 0) {
      best = { ...best, tailoredCv: backfillMissingSkills(best.tailoredCv, stillMissing) }
    }

    return { content: best, model, usage }
  }
}
