// Builds a download filename for a generated document using the logged-in user's
// name and email, e.g. "Nurul Komor - nurul@example.com - CV.pdf". Falls back to
// just the document label when name/email are missing, and strips characters that
// are illegal in filenames.
export function materialFileName(opts: {
  fullName?: string | null
  email?: string | null
  kind: 'cv' | 'cover'
  ext: 'pdf' | 'docx'
}): string {
  const label = opts.kind === 'cv' ? 'CV' : 'Cover Letter'
  const base = [opts.fullName, opts.email, label]
    .map((part) => (part ?? '').trim())
    .filter(Boolean)
    .join(' - ')
    .replace(/[\\/:*?"<>|\n\r]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return `${base || label}.${opts.ext}`
}
