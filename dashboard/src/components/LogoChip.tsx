// Company avatar chip. Per the restrained-color rule, every chip uses one neutral
// treatment (set in .logo-chip) rather than a per-company color — the initials
// carry identity, not a swatch.
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
    <span className="logo-chip" style={{ width: size, height: size, fontSize: size * 0.36 }}>
      {initialsFor(name)}
    </span>
  )
}
