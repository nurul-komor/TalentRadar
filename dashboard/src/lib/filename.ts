// Builds a download filename for a generated document from the logged-in user's
// name and the company applied to, e.g. "Nurul_Komor_Acme_CV.pdf". Falls back to
// whichever parts are available, down to the bare document label.
//
// ATS note 1 — CHARACTERS: scanners flag spaces and punctuation in a résumé's
// file name because some parsers choke on them, so every part is reduced to
// [A-Za-z0-9] runs joined by underscores: never a space, hyphen, "@", or dot
// before the extension.
//
// ATS note 2 — UNIQUENESS: the company is part of the name specifically so that
// downloading materials for different jobs doesn't collide in the user's
// Downloads folder. A collision makes the browser append " (1)", which
// reintroduces the exact characters — space and parentheses — that note 1 exists
// to avoid, and the app never sees that rename.
export function materialFileName(opts: {
  fullName?: string | null
  company?: string | null
  kind: 'cv' | 'cover'
  ext: 'pdf' | 'docx'
}): string {
  const label = opts.kind === 'cv' ? 'CV' : 'Cover_Letter'
  const base = [opts.fullName, opts.company, label]
    .map((part) => (part ?? '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, ''))
    .filter(Boolean)
    .join('_')
  return `${base || label}.${opts.ext}`
}
