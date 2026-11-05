import { ObjectId, type Db } from 'mongodb'
import type { UserJob, UserJobPreview } from '@job-hunter/shared'
import { UserJobPreviewSchema } from '@job-hunter/shared'
import type { LlmProvider } from '../llm/types.js'
import {
  USER_JOB_EXTRACTION_SYSTEM_PROMPT,
  buildUserJobExtractionUserPrompt,
} from '../llm/prompts.js'
import { fetchWithPolicy } from '../discovery/fetchWithPolicy.js'
import { decodeEntities } from '../discovery/sources/htmlUtils.js'

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

  // Try the LLM extractor first; any failure (network, budget, or an output
  // shape that doesn't validate) degrades to heuristic extraction rather than
  // failing the whole sync.
  if (extractor) {
    try {
      const fields = await extractor({ url, pageText: pageText.slice(0, 30_000) })
      return UserJobPreviewSchema.parse({ ...fields, url })
    } catch {
      // fall through to heuristics
    }
  }

  return UserJobPreviewSchema.parse({ ...heuristicExtract(url, html, pageText), url })
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
