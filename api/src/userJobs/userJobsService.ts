import { ObjectId, type Db } from 'mongodb'
import type { UserJob, UserJobPreview } from '@job-hunter/shared'
import { UserJobPreviewSchema } from '@job-hunter/shared'
import type { LlmProvider } from '../llm/types.js'
import {
  USER_JOB_EXTRACTION_SYSTEM_PROMPT,
  buildUserJobExtractionUserPrompt,
} from '../llm/prompts.js'
import { fetchWithPolicy } from '../discovery/fetchWithPolicy.js'
import { decodeEntities, stripTags } from '../discovery/sources/htmlUtils.js'

// Fields an extractor pulls out of a pasted job page. Mirrors the saved shape
// minus the URL (the caller already knows that) and ownership fields.
export interface ExtractedJobFields {
  title: string
  company: string
  description: string
  location: string | null
  salaryMin: number | null
  salaryMax: number | null
}

export type JobPageExtractor = (input: { url: string; pageText: string }) => Promise<ExtractedJobFields>

const USER_JOB_JSON_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    company: { type: 'string' },
    description: { type: 'string' },
    location: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    salaryMin: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    salaryMax: { anyOf: [{ type: 'number' }, { type: 'null' }] },
  },
  required: ['title', 'company', 'description', 'location', 'salaryMin', 'salaryMax'],
  additionalProperties: false,
} satisfies Record<string, unknown>

export async function ensureUserJobsIndexes(db: Db): Promise<void> {
  await db.collection('userJobs').createIndex({ profileId: 1, createdAt: -1 })
}

// Strips a full HTML document down to readable visible text: drops <script> and
// <style> blocks, replaces tags with spaces, collapses whitespace but keeps
// paragraph breaks. Deliberately dependency-free, mirroring discovery/htmlUtils.
function htmlToVisibleText(html: string): string {
  const withoutScripts = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, ' ')
  const withBreaks = withoutScripts
    .replace(/<\/(p|div|li|h[1-6]|br|tr|section|article)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
  const text = decodeEntities(withBreaks.replace(/<[^>]+>/g, ' '))
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .trim()
}

function matchFirst(html: string, regex: RegExp): string | null {
  const m = regex.exec(html)
  return m ? decodeEntities(m[1]).trim() || null : null
}

// Best-effort structured extraction without an LLM: pulls the page title and
// og: tags. Good enough to pre-fill the preview so the user can edit the rest.
function heuristicExtract(url: string, html: string, pageText: string): ExtractedJobFields {
  const ogTitle = matchFirst(html, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
  const titleTag = matchFirst(html, /<title[^>]*>([^<]+)<\/title>/i)
  const ogSite = matchFirst(html, /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i)
  const ogDesc = matchFirst(html, /<meta[^>]+(?:name|property)=["'](?:og:)?description["'][^>]+content=["']([^"']+)["']/i)

  let host = ''
  try {
    host = new URL(url).hostname.replace(/^www\./, '')
  } catch {
    host = ''
  }

  return {
    title: (ogTitle ?? titleTag ?? '').slice(0, 300),
    company: (ogSite ?? host).slice(0, 200),
    // Prefer the readable body text; fall back to the meta description.
    description: (pageText || ogDesc || '').slice(0, 20_000),
    location: null,
    salaryMin: null,
    salaryMax: null,
  }
}

// Pulls scalar/nested names out of schema.org shapes that may be a plain string,
// an object with a `name`, or an array of either.
function readName(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null
  if (Array.isArray(value)) {
    for (const entry of value) {
      const name = readName(entry)
      if (name) return name
    }
    return null
  }
  if (value && typeof value === 'object') {
    const name = (value as Record<string, unknown>).name
    return typeof name === 'string' ? name.trim() || null : null
  }
  return null
}

// Flattens a schema.org PostalAddress (or array of jobLocations) into a readable
// "City, Region, Country" string.
function readLocation(value: unknown): string | null {
  if (!value) return null
  if (Array.isArray(value)) {
    for (const entry of value) {
      const loc = readLocation(entry)
      if (loc) return loc
    }
    return null
  }
  if (typeof value === 'string') return value.trim() || null
  const obj = value as Record<string, unknown>
  const address = (obj.address ?? obj) as Record<string, unknown>
  const parts = [address.addressLocality, address.addressRegion, address.addressCountry]
    .map((p) => (typeof p === 'string' ? p.trim() : readName(p)))
    .filter((p): p is string => Boolean(p))
  return parts.length ? [...new Set(parts)].join(', ') : null
}

// Reads min/max out of a schema.org MonetaryAmount `baseSalary`.
function readSalary(value: unknown): { salaryMin: number | null; salaryMax: number | null } {
  const result = { salaryMin: null as number | null, salaryMax: null as number | null }
  if (!value || typeof value !== 'object') return result
  const amount = ((value as Record<string, unknown>).value ?? value) as Record<string, unknown>
  const toNum = (v: unknown): number | null => {
    const n = typeof v === 'string' ? Number(v.replace(/[^0-9.]/g, '')) : typeof v === 'number' ? v : NaN
    return Number.isFinite(n) ? n : null
  }
  const min = toNum(amount.minValue)
  const max = toNum(amount.maxValue)
  const single = toNum(amount.value)
  result.salaryMin = min ?? single
  result.salaryMax = max ?? single
  return result
}

// Walks arbitrarily-nested JSON-LD (objects, arrays, @graph) for a JobPosting node.
function findJobPostingNode(node: unknown): Record<string, unknown> | null {
  if (!node || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const entry of node) {
      const found = findJobPostingNode(entry)
      if (found) return found
    }
    return null
  }
  const obj = node as Record<string, unknown>
  const type = obj['@type']
  const types = Array.isArray(type) ? type : [type]
  if (types.some((t) => typeof t === 'string' && t.toLowerCase() === 'jobposting')) return obj
  if (obj['@graph']) return findJobPostingNode(obj['@graph'])
  return null
}

// Best-effort extraction from schema.org JobPosting JSON-LD, which many sites
// (including JS-rendered ones) embed in the server HTML even when the visible
// body is client-rendered. Returns only the fields it can confidently read.
function extractJsonLdJobPosting(html: string): Partial<ExtractedJobFields> | null {
  const blocks = html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  )
  for (const block of blocks) {
    let parsed: unknown
    try {
      parsed = JSON.parse(block[1].trim())
    } catch {
      continue
    }
    const node = findJobPostingNode(parsed)
    if (!node) continue

    const fields: Partial<ExtractedJobFields> = {}
    const title = readName(node.title)
    if (title) fields.title = title.slice(0, 300)
    const company = readName(node.hiringOrganization)
    if (company) fields.company = company.slice(0, 200)
    if (typeof node.description === 'string') {
      const description = stripTags(node.description).trim()
      if (description) fields.description = description.slice(0, 20_000)
    }
    const location = readLocation(node.jobLocation)
    if (location) fields.location = location
    const { salaryMin, salaryMax } = readSalary(node.baseSalary)
    if (salaryMin !== null) fields.salaryMin = salaryMin
    if (salaryMax !== null) fields.salaryMax = salaryMax
    return fields
  }
  return null
}

// A client-rendered SPA serves an empty shell (often a "Loading…" placeholder),
// so there's almost no readable body text. Below this length we treat the page
// as a shell and skip the LLM call — there's nothing worth extracting, so we
// fall back to JSON-LD / og-tag heuristics for a best-effort, editable preview.
const MIN_READABLE_TEXT = 200

// Merges partial field sources in priority order (earlier wins), skipping empty
// strings and nulls so a later source can fill a gap an earlier one left. Used
// to layer LLM / JSON-LD / heuristic results into one complete preview.
function coalesceFields(...sources: Array<Partial<ExtractedJobFields> | null>): ExtractedJobFields {
  const pick = (key: keyof ExtractedJobFields): unknown => {
    for (const source of sources) {
      const value = source?.[key]
      if (value !== undefined && value !== null && value !== '') return value
    }
    return null
  }
  return {
    title: (pick('title') as string | null) ?? '',
    company: (pick('company') as string | null) ?? '',
    description: (pick('description') as string | null) ?? '',
    location: pick('location') as string | null,
    salaryMin: pick('salaryMin') as number | null,
    salaryMax: pick('salaryMax') as number | null,
  }
}

// Wires an LLM provider into a page extractor. Returned only when a provider is
// configured; otherwise the route falls back to heuristicExtract.
export function createJobPageExtractor(provider: LlmProvider, model: string): JobPageExtractor {
  return async ({ url, pageText }) => {
    const { output } = await provider.complete<ExtractedJobFields>({
      model,
      maxOutputTokens: 4096,
      system: USER_JOB_EXTRACTION_SYSTEM_PROMPT,
      user: buildUserJobExtractionUserPrompt({ url, pageText }),
      schemaName: 'user_job',
      jsonSchema: USER_JOB_JSON_SCHEMA,
      parse: (content: string): ExtractedJobFields => JSON.parse(content) as ExtractedJobFields,
    })
    return output
  }
}

export class PreviewError extends Error {}

// Fetch a pasted URL and turn it into an editable, not-yet-saved preview.
// Uses the LLM extractor when provided, with a heuristic fallback so the
// feature still works (just less polished) when the extractor is unavailable
// or errors out.
export async function previewJobFromUrl(
  url: string,
  extractor: JobPageExtractor | null
): Promise<UserJobPreview> {
  let response: Response
  try {
    response = await fetchWithPolicy(url)
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : String(reason)
    throw new PreviewError(`Could not reach that URL: ${message}`)
  }
  if (!response.ok) {
    throw new PreviewError(`The page returned HTTP ${response.status}.`)
  }

  const html = await response.text()
  const pageText = htmlToVisibleText(html)
  const jsonLd = extractJsonLdJobPosting(html)

  // A JS-rendered SPA returns an empty shell: no structured data and almost no
  // readable text. We don't block on that — the user can still add the job and
  // fill in the details by hand — so we skip the (pointless) LLM call and return
  // whatever the og-tag/title heuristic and any JSON-LD could recover.

  // Try the LLM extractor first; any failure (network, budget, or an output
  // shape that doesn't validate) degrades to heuristic extraction rather than
  // failing the whole sync. Only worth calling when there's readable text to
  // extract from — a shell with JSON-LD is better served by that structured data.
  if (extractor && pageText.length >= MIN_READABLE_TEXT) {
    try {
      const fields = await extractor({ url, pageText: pageText.slice(0, 30_000) })
      // LLM wins; JSON-LD fills any gaps the model left null/empty.
      return UserJobPreviewSchema.parse({ ...coalesceFields(fields, jsonLd), url })
    } catch (reason) {
      console.warn('user job LLM extraction failed; falling back to heuristic', reason)
    }
  }

  // No usable LLM output: JSON-LD (most reliable) wins, with the title/og-tag
  // heuristic filling whatever structured data didn't cover. For a shell page
  // the "body text" is just nav/footer chrome, so we don't pre-fill the
  // description with it — leave it blank for the user to enter by hand.
  const bodyText = pageText.length >= MIN_READABLE_TEXT ? pageText : ''
  const heuristic = heuristicExtract(url, html, bodyText)
  return UserJobPreviewSchema.parse({ ...coalesceFields(jsonLd, heuristic), url })
}

export async function createUserJob(
  db: Db,
  profileId: string,
  input: {
    title: string
    company: string
    description: string
    location?: string | null
    salaryMin?: number | null
    salaryMax?: number | null
    url?: string | null
    visibility: UserJob['visibility']
  }
): Promise<UserJob> {
  const now = new Date().toISOString()
  const doc: UserJob = {
    profileId,
    title: input.title,
    company: input.company,
    description: input.description,
    location: input.location ?? null,
    salaryMin: input.salaryMin ?? null,
    salaryMax: input.salaryMax ?? null,
    url: input.url ?? null,
    visibility: input.visibility,
    createdAt: now,
    updatedAt: now,
  }
  const result = await db.collection<UserJob>('userJobs').insertOne(doc)
  return { ...doc, _id: result.insertedId.toString() }
}

export async function listUserJobs(db: Db, profileId: string): Promise<UserJob[]> {
  return db
    .collection<UserJob>('userJobs')
    .find({ profileId })
    .sort({ createdAt: -1 })
    .toArray()
}

// Fetch a single saved job the caller owns. Returns null for a missing job, an
// invalid id, or one owned by someone else — callers can't tell those apart,
// which keeps another user's jobs unenumerable.
export async function getUserJob(db: Db, profileId: string, id: string): Promise<UserJob | null> {
  if (!ObjectId.isValid(id)) return null
  // Query by ObjectId `_id` via the untyped collection handle (the shared schema
  // types `_id` as a string), matching the pattern in the route handlers.
  const doc = await db.collection('userJobs').findOne({ _id: new ObjectId(id), profileId })
  return doc ? (doc as unknown as UserJob) : null
}

// Re-fetch a link-synced job from its stored URL and refresh the extracted
// fields in place. Only jobs that carry a `url` can be resynced (manually-typed
// jobs have nothing to pull from). The owner's visibility, url, and createdAt
// are preserved; everything the extractor returns is overwritten.
export async function resyncUserJob(
  db: Db,
  profileId: string,
  id: string,
  extractor: JobPageExtractor | null
): Promise<UserJob | null> {
  const existing = await getUserJob(db, profileId, id)
  if (!existing) return null
  if (!existing.url) {
    throw new PreviewError('This job has no source URL to resync from.')
  }

  const preview = await previewJobFromUrl(existing.url, extractor)
  const result = await db.collection('userJobs').findOneAndUpdate(
    { _id: new ObjectId(id), profileId },
    {
      $set: {
        title: preview.title,
        company: preview.company,
        description: preview.description,
        location: preview.location,
        salaryMin: preview.salaryMin,
        salaryMax: preview.salaryMax,
        updatedAt: new Date().toISOString(),
      },
    },
    { returnDocument: 'after' }
  )
  return result ? (result as unknown as UserJob) : null
}
