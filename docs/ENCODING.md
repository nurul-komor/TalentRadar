# Text encoding & mojibake repair

How the discovery pipeline keeps job text free of **mojibake** — garbled
characters such as `company) â Remote` (should be `company) — Remote`) or
`Â£30,000` (should be `£30,000`).

## Symptom

Job titles, descriptions, and locations rendered in the dashboard contained
garbled characters:

| Shown in the UI | Should be | What it is |
|---|---|---|
| `company) â Remote` | `company) — Remote` | em dash |
| `$48,000â$57,000` | `$48,000–$57,000` | en dash |
| `Â£30,000âÂ£35,000` | `£30,000–£35,000` | pound sign + en dash |
| `isnâ€™t` | `isn't` | curly apostrophe |
| `ends soonâ¦` | `ends soon…` | ellipsis |
| `Ø¯Ø¨Ù, Ø§ÙØ¹Ø±Ø¨ÙØ©` | `دبي, العربية` | Arabic script |

At one point **11 of 20** jobs returned by `/jobs` carried at least one of
these sequences.

## Root cause

Classic **"UTF-8 decoded as Latin-1"** mojibake, introduced *upstream* of us.

The em dash `—` is UTF-8 bytes `E2 80 94`. Inspecting a stored record shows the
three codepoints `U+00E2 U+0080 U+0094` — i.e. each UTF-8 byte was reinterpreted
as a single ISO-8859-1 (Latin-1) codepoint, then re-serialized as UTF-8. Some
feeds (notably RemoteOK's JSON API) ship text that was already mangled this way,
so `res.json()` faithfully decodes the mangled bytes and the garbling is
preserved.

The dashboard is **not** at fault — React renders strings verbatim. The bad
bytes are present in the data served by the API, which means they were written
to MongoDB at discovery time.

## Fix

The mangling is deterministic and **losslessly reversible**: map each codepoint
(all in `0x00–0xFF`) back to a byte, then decode the byte run as UTF-8.

### Ingestion-time repair

`api/src/discovery/textEncoding.ts` exports `repairMojibake(text)`. It is applied
to the user-facing text fields (`title`, `company`, `rawDescription`, `location`)
inside `persistPosting` in `discovery/discoveryService.ts` — the single point
every source converges on before a job is written — so **all** current and
future sources are covered. The repair runs *before* the dedupe check so the
company/title heuristic compares repaired text against repaired rows.

`repairMojibake` is intentionally conservative — it returns the input unchanged
unless **all** of these hold, so it is always safe to run over clean text:

1. The string contains a mojibake **signature**: a byte that would be a UTF-8
   lead byte (`C2–F4`) immediately followed by a continuation byte (`80–BF`).
   Plain Latin-1 text (e.g. `café`, `naïve`) almost never produces this pairing.
2. Every codepoint fits in a single byte (`≤ 0xFF`). If a genuine multi-byte
   character is already present (e.g. a real `—` at `U+2014`), the string isn't
   this flavour of mojibake and is left alone.
3. The reinterpreted bytes are **valid UTF-8**, verified with a
   `TextDecoder('utf-8', { fatal: true })` so a false positive can never emit
   `U+FFFD` replacement characters.

It applies up to two passes to cover the rare doubly-mangled case, and is
idempotent — re-running on repaired text is a no-op.

### Backfilling existing rows

Discovery skips jobs it has already seen, so rows saved before the fix are never
updated through a normal run. Repair them in place with the one-off script:

```bash
cd api
# Dry run — lists what would change, writes nothing:
npx tsx --env-file=.env src/scripts/repairJobEncoding.ts
# Apply:
npx tsx --env-file=.env src/scripts/repairJobEncoding.ts --write
```

The script scans every job, repairs the four text fields, and only writes rows
that actually change. It is safe to re-run.

## Tests

- `api/test/discovery/textEncoding.test.ts` — unit coverage: em/en dash, pound,
  apostrophe, ellipsis, Arabic, plus negative cases (plain ASCII and
  already-correct UTF-8 like `Café — Zürich` must pass through untouched).
- `api/test/discovery/discoveryService.test.ts` — asserts a mangled posting is
  stored clean end-to-end.

## If new garbling appears

1. Confirm it's in the API, not the UI: `curl "$API/jobs?limit=20"` and look for
   the sequence in the JSON.
2. Inspect the codepoints of the bad run. If they are all `≤ 0xFF` and form valid
   UTF-8 when reinterpreted as bytes, `repairMojibake` already handles it — just
   backfill. If not (e.g. real `U+FFFD` replacement chars, which are
   information-destroying and unrecoverable), the source adapter is decoding the
   response with the wrong charset and must be fixed at fetch time instead.
