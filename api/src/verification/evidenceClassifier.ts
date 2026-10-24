export interface EvidenceClassification {
  status: 'verified' | 'rejected' | 'inconclusive'
  evidence: string | null
}

export const NEGATIVE_EVIDENCE_PATTERNS: string[] = [
  'no longer accepting applications',
  'position has been filled',
  'this position is no longer available',
  'this job has expired',
  'this listing has expired',
  'applications are now closed',
  'job not found',
  'page not found',
]

export const POSITIVE_EVIDENCE_PATTERNS: string[] = [
  'apply now',
  'apply for this job',
  'apply for this position',
  'submit your application',
  'apply today',
  'easy apply',
]

export function classifyEvidence(pageText: string): EvidenceClassification {
  const lowered = pageText.toLowerCase()

  for (const pattern of NEGATIVE_EVIDENCE_PATTERNS) {
    if (lowered.includes(pattern)) {
      return { status: 'rejected', evidence: pattern }
    }
  }

  for (const pattern of POSITIVE_EVIDENCE_PATTERNS) {
    if (lowered.includes(pattern)) {
      return { status: 'verified', evidence: pattern }
    }
  }

  return { status: 'inconclusive', evidence: null }
}

export function stripHtmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
