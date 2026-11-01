const PALETTE = ['#4453FF', '#1FC9B7', '#6B78FF', '#0A0F1E', '#7A6CFF', '#E07A2F']

function colorFor(seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  }
  return PALETTE[hash % PALETTE.length]
}

function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

interface LogoChipProps {
  name: string
  size?: number
}

export function LogoChip({ name, size = 36 }: LogoChipProps) {
  return (
    <span
      className="logo-chip"
      style={{ width: size, height: size, fontSize: size * 0.36, background: colorFor(name) }}
    >
      {initialsFor(name)}
    </span>
  )
}
