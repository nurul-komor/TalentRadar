// Small shared helpers for the HTML-scraping job sources (companies that
// server-render their careers pages instead of exposing a JSON API). These are
// deliberately dependency-free regex utilities — good enough for the simple,
// well-structured markup these ATSs emit, and easy to adjust when a site changes.

export function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&#0?38;/g, '&')
    .replace(/&#0?39;/g, "'")
    .replace(/&#8217;/g, '’')
    .replace(/&#8211;/g, '–')
    .replace(/&#8212;/g, '—')
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

export function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim()
}

// Inner HTML of the first <div> whose class attribute contains `classToken`,
// matched by counting nested <div> tags so inner markup is preserved intact.
export function extractDivByClass(html: string, classToken: string): string {
  const open = new RegExp(`<div[^>]*class="[^"]*${classToken}[^"]*"[^>]*>`).exec(html)
  if (!open) return ''
  const start = open.index + open[0].length
  const tag = /<\/?div\b[^>]*>/g
  tag.lastIndex = start
  let depth = 1
  let match: RegExpExecArray | null
  while ((match = tag.exec(html)) !== null) {
    depth += match[0].startsWith('</') ? -1 : 1
    if (depth === 0) return html.slice(start, match.index).trim()
  }
  return html.slice(start).trim()
}

// First non-empty text line inside a block of HTML (after stripping tags).
export function firstTextLine(html: string): string | null {
  const text = stripTags(html)
  return text ? text.split(/\s{2,}|\n/)[0].trim() || text : null
}
