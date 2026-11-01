import type { ReactNode } from 'react'

type Tone = 'default' | 'mono' | 'verified' | 'govt'

interface PillProps {
  tone?: Tone
  children: ReactNode
}

const TONE_CLASS: Record<Tone, string> = {
  default: 'pill',
  mono: 'pill mono',
  verified: 'pill verified',
  govt: 'pill govt',
}

export function Pill({ tone = 'default', children }: PillProps) {
  return (
    <span className={TONE_CLASS[tone]}>
      {tone === 'verified' ? <span className="scan" aria-hidden="true" /> : null}
      {children}
    </span>
  )
}

export function VerifiedPill() {
  return <Pill tone="verified">Verified</Pill>
}
