// Repairs "mojibake" — text whose bytes were UTF-8 but got decoded as
// Latin-1 / Windows-1252 somewhere upstream, then re-saved. Several of our
// sources (notably RemoteOK's JSON feed) serve already-mangled text: an em
// dash "—" (UTF-8 bytes E2 80 94) arrives as the three codepoints
// U+00E2 U+0080 U+0094, i.e. "â\x80\x94". That mangling is deterministic and
// lossless to reverse: encode each codepoint back to a byte, then decode the
// byte run as UTF-8.
//
// Common visible symptoms this fixes:
//   "company) â Remote"      -> "company) — Remote"   (em dash)
//   "Â£30,000âÂ£35,000"       -> "£30,000–£35,000"     (pound + en dash)
//   "isnâ€™t"                 -> "isn't"               (curly apostrophe)
//   "Ø¯Ø¨Ù, Ø§ÙØ¹Ø±Ø¨ÙØ©"     -> "دبي, العربية"         (Arabic script)

// Signature of a Latin-1-decoded UTF-8 lead byte (C2–DF = 2-byte, E0–EF =
// 3-byte, F0–F4 = 4-byte sequences) immediately followed by a continuation
// byte (80–BF). Plain Latin-1 text almost never produces this pairing, so it
// keeps us from "repairing" text that was never broken.
const MOJIBAKE_SIGNATURE = /[Â-ßà-ïð-ô][-¿]/

// Decodes a byte run as UTF-8 and throws on any invalid sequence, so a false
// positive can never silently emit U+FFFD replacement characters.
const strictUtf8 = new TextDecoder('utf-8', { fatal: true })

function repairOnce(text: string): string | null {
  // The byte round-trip only makes sense when every codepoint fits in a single
  // byte (0x00–0xFF). If the string already contains a genuine multi-byte
  // character (e.g. a real "—" at U+2014), it isn't this flavour of mojibake,
  // so leave it untouched rather than risk corrupting it.
  const bytes = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i)
    if (code > 0xff) return null
    bytes[i] = code
  }

  try {
    return strictUtf8.decode(bytes)
  } catch {
    // Not valid UTF-8 once reinterpreted — not our kind of mojibake.
    return null
  }
}

/**
 * Reverses UTF-8-decoded-as-Latin-1 mojibake. Returns the original string
 * unchanged when it shows no mojibake signature or cannot be safely repaired,
 * so it is always safe to run over clean text. Applies up to two passes to
 * cover the (rare) doubly-mangled case.
 */
export function repairMojibake(text: string): string {
  let current = text
  for (let pass = 0; pass < 2; pass += 1) {
    if (!MOJIBAKE_SIGNATURE.test(current)) break
    const repaired = repairOnce(current)
    if (repaired === null || repaired === current) break
    current = repaired
  }
  return current
}
