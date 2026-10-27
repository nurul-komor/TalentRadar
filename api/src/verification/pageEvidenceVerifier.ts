import { fetchWithPolicy } from '../discovery/fetchWithPolicy.js'
import { classifyEvidence, stripHtmlToText } from './evidenceClassifier.js'
import type { JobVerifier, VerificationOutcome } from './types.js'

const GONE_STATUS_CODES = new Set([404, 410])

export const pageEvidenceVerifier: JobVerifier = async (url: string): Promise<VerificationOutcome> => {
  try {
    const res = await fetchWithPolicy(url)

    if (GONE_STATUS_CODES.has(res.status)) {
      return { status: 'rejected', httpStatus: res.status, evidence: `HTTP ${res.status}` }
    }
    if (!res.ok) {
      return { status: 'inconclusive', httpStatus: res.status, evidence: `HTTP ${res.status}` }
    }

    const html = await res.text()
    const classification = classifyEvidence(stripHtmlToText(html))
    return { status: classification.status, httpStatus: res.status, evidence: classification.evidence }
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : String(reason)
    return { status: 'inconclusive', httpStatus: null, evidence: message }
  }
}
