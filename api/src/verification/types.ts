export interface VerificationOutcome {
  status: 'verified' | 'rejected' | 'inconclusive'
  httpStatus: number | null
  evidence: string | null
}

export type JobVerifier = (url: string) => Promise<VerificationOutcome>
