type Tier = 'high' | 'mid' | 'low'

function tierFor(score: number): Tier {
  if (score >= 80) return 'high'
  if (score >= 50) return 'mid'
  return 'low'
}

const TIER_CLASS: Record<Tier, string> = { high: '', mid: 't2', low: 't3' }

interface ScoreRingProps {
  score: number
  size?: number
  strokeWidth?: number
}

export function ScoreRing({ score, size = 40, strokeWidth = 4 }: ScoreRingProps) {
  const clamped = Math.max(0, Math.min(100, score))
  const center = size / 2
  const radius = center - strokeWidth
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - clamped / 100)
  const tierClass = TIER_CLASS[tierFor(clamped)]

  return (
    <div className="score-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle className="track" cx={center} cy={center} r={radius} fill="none" strokeWidth={strokeWidth} />
        <circle
          className={`fill ${tierClass}`}
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <span className={`num ${tierClass}`}>{clamped}</span>
    </div>
  )
}
