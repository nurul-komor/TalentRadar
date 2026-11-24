// A fixed logo for a job source when its favicon wouldn't represent the employer.
// Teletalk government jobs (alljobs.teletalk.com.bd) have no company website to
// derive a favicon from, so show the Bangladesh government emblem instead.

export const GOVT_LOGO_URL =
  'https://static.youthop.com/uploads/sites/2/2020/04/bangladesh-govt-logo.jpg'

// Returns a fixed logo URL for a source whose favicon wouldn't represent the
// employer (e.g. government listings), or null to fall back to favicon/monogram.
export function sourceLogoUrl(sourceId?: string | null): string | null {
  return sourceId === 'teletalk-govt' ? GOVT_LOGO_URL : null
}
