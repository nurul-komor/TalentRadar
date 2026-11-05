import { describe, it, expect } from 'vitest'
import { repairMojibake } from '../../src/discovery/textEncoding'

// Helper: produce the exact mojibake a source emits when UTF-8 bytes were
// decoded as Latin-1 upstream (each UTF-8 byte becomes a U+00xx codepoint).
function mangle(text: string): string {
  const utf8 = Buffer.from(text, 'utf8')
  let out = ''
  for (const byte of utf8) out += String.fromCharCode(byte)
  return out
}

describe('repairMojibake', () => {
  it('repairs an em dash', () => {
    expect(repairMojibake(mangle('company) — Remote'))).toBe('company) — Remote')
  })

  it('repairs a pound sign and en dash together', () => {
    expect(repairMojibake(mangle('£30,000–£35,000'))).toBe('£30,000–£35,000')
  })

  it('repairs a curly apostrophe', () => {
    expect(repairMojibake(mangle("isn't just a job"))).toBe("isn't just a job")
  })

  it('repairs an ellipsis', () => {
    expect(repairMojibake(mangle('ends soon…'))).toBe('ends soon…')
  })

  it('repairs non-Latin scripts (Arabic)', () => {
    expect(repairMojibake(mangle('دبي, الإمارات العربية المتحدة'))).toBe(
      'دبي, الإمارات العربية المتحدة'
    )
  })

  it('leaves plain ASCII untouched', () => {
    expect(repairMojibake('Senior Backend Engineer (Remote)')).toBe(
      'Senior Backend Engineer (Remote)'
    )
  })

  it('leaves already-correct UTF-8 untouched', () => {
    // A real em dash and accented letters that were never mangled.
    expect(repairMojibake('Café — Zürich')).toBe('Café — Zürich')
    expect(repairMojibake('naïve résumé')).toBe('naïve résumé')
  })

  it('is idempotent on repaired text', () => {
    const once = repairMojibake(mangle('£30,000–£35,000'))
    expect(repairMojibake(once)).toBe(once)
  })

  it('returns the empty string unchanged', () => {
    expect(repairMojibake('')).toBe('')
  })
})
