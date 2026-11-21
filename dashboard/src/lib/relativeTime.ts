// Relative timestamps ("2 hours ago") are computed against the browser clock so
// they always read in the viewer's own local time, regardless of how the API
// serialised the date.
export function relativeTimeFromNow(dateString: string): string {
  const timestamp = new Date(dateString).getTime()
  if (Number.isNaN(timestamp)) return '—'

  const diffSeconds = Math.round((Date.now() - timestamp) / 1000)
  if (diffSeconds < 0) return 'just now'

  const diffMinutes = Math.round(diffSeconds / 60)
  const diffHours = Math.round(diffMinutes / 60)
  const diffDays = Math.round(diffHours / 24)

  if (diffSeconds < 60) return 'just now'
  if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`
  if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`
  if (diffDays < 30) {
    const diffWeeks = Math.round(diffDays / 7)
    return `${diffWeeks} week${diffWeeks === 1 ? '' : 's'} ago`
  }
  if (diffDays < 365) {
    const diffMonths = Math.round(diffDays / 30)
    return `${diffMonths} month${diffMonths === 1 ? '' : 's'} ago`
  }
  const diffYears = Math.round(diffDays / 365)
  return `${diffYears} year${diffYears === 1 ? '' : 's'} ago`
}

// Full local date/time, for tooltips next to a relative label.
export function absoluteLocalTime(dateString: string): string {
  const date = new Date(dateString)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString()
}
