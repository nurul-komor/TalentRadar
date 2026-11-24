import { Fragment, type ReactNode } from 'react'

// Renders the tailored-CV Markdown the API generates (`# name`, `## section`,
// `- bullet`, `**bold**`, `[label](url)`) as clean, formatted text — so a live
// project link shows as a clickable "(Visit)" rather than the raw
// `[(Visit)](https://…)` markdown. Mirrors the PDF/DOCX exporter's parser
// (api/src/materials/exporters.ts) so the preview matches the downloaded file.

// Matches **bold** and [label](url), scanning left to right.
const INLINE_TOKEN_RE = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)]+)\)/g

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let lastIndex = 0
  let i = 0
  for (const m of text.matchAll(INLINE_TOKEN_RE)) {
    const start = m.index ?? 0
    if (start > lastIndex) nodes.push(<Fragment key={`${keyPrefix}-t${i}`}>{text.slice(lastIndex, start)}</Fragment>)
    if (m[1] !== undefined) {
      nodes.push(
        <strong key={`${keyPrefix}-b${i}`} className="font-semibold text-foreground">
          {m[1]}
        </strong>,
      )
    } else {
      nodes.push(
        <a
          key={`${keyPrefix}-l${i}`}
          href={m[3]}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-primary underline underline-offset-2 hover:opacity-80"
        >
          {m[2]}
        </a>,
      )
    }
    lastIndex = start + m[0].length
    i += 1
  }
  if (lastIndex < text.length) nodes.push(<Fragment key={`${keyPrefix}-t${i}`}>{text.slice(lastIndex)}</Fragment>)
  return nodes
}

export function CvPreview({ text, className }: { text: string; className?: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  return (
    <div className={className}>
      {lines.map((raw, idx) => {
        const t = raw.trim()
        const key = `l${idx}`
        if (t === '') return <div key={key} className="h-2" aria-hidden="true" />
        if (t.startsWith('# ')) {
          return (
            <p key={key} className="text-base font-semibold text-foreground">
              {renderInline(t.slice(2).trim(), key)}
            </p>
          )
        }
        if (/^#{2,6}\s/.test(t)) {
          return (
            <p key={key} className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {renderInline(t.replace(/^#{2,6}\s/, '').trim(), key)}
            </p>
          )
        }
        if (/^[-*]\s+/.test(t)) {
          return (
            <p key={key} className="flex gap-2 text-foreground">
              <span aria-hidden="true" className="select-none text-muted-foreground">
                •
              </span>
              <span>{renderInline(t.replace(/^[-*]\s+/, '').trim(), key)}</span>
            </p>
          )
        }
        return (
          <p key={key} className="text-foreground">
            {renderInline(t, key)}
          </p>
        )
      })}
    </div>
  )
}
