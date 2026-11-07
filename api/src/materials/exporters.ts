import PDFDocument from 'pdfkit'
import { Document, Packer, Paragraph, TextRun, ExternalHyperlink, HeadingLevel } from 'docx'

// The tailored CV is generated as GitHub-flavored Markdown. These helpers parse
// the small subset it uses — `# name`, `## section`, `- bullet`, `**bold**`, and
// `[label](url)` links — so the PDF/DOCX come out formatted (and links clickable)
// rather than showing literal markdown markers.
// Legacy records (plain UPPERCASE headings, no markdown) are still handled.

const LINK_COLOR = '1A56DB'

const LEGACY_SECTION_HEADINGS = new Set([
  'SUMMARY',
  'PROFESSIONAL SUMMARY',
  'SKILLS',
  'TECHNICAL SKILLS',
  'CORE SKILLS',
  'EXPERIENCE',
  'WORK EXPERIENCE',
  'PROFESSIONAL EXPERIENCE',
  'PROJECTS',
  'EDUCATION',
  'CERTIFICATIONS',
  'AWARDS',
  'ACHIEVEMENTS',
])

type LineKind = 'name' | 'heading' | 'bullet' | 'text'

interface ParsedLine {
  kind: LineKind
  text: string // structure markers stripped; inline **bold** and [label](url) preserved
}

interface InlineSegment {
  text: string
  bold: boolean
  href?: string // set when the segment is a hyperlink
}

function classifyLine(raw: string): ParsedLine | null {
  const t = raw.trim()
  if (t === '') return null
  if (t.startsWith('# ')) return { kind: 'name', text: t.slice(2).trim() }
  if (/^#{2,6}\s/.test(t)) return { kind: 'heading', text: t.replace(/^#{2,6}\s/, '').trim() }
  if (/^[-*]\s+/.test(t)) return { kind: 'bullet', text: t.replace(/^[-*]\s+/, '').trim() }
  // Legacy: a short all-caps line with no markdown is a section heading.
  if (t === t.toUpperCase() && t.length <= 32 && (LEGACY_SECTION_HEADINGS.has(t) || /^[A-Z][A-Z &/]+$/.test(t))) {
    return { kind: 'heading', text: t }
  }
  return { kind: 'text', text: t }
}

// Splits a line into normal / bold (**…**) / link ([label](url)) segments,
// scanning left to right so bold and links can both appear on the same line.
const INLINE_TOKEN_RE = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)]+)\)/g

export function inlineSegments(text: string): InlineSegment[] {
  const segments: InlineSegment[] = []
  let lastIndex = 0
  for (const m of text.matchAll(INLINE_TOKEN_RE)) {
    const start = m.index ?? 0
    if (start > lastIndex) segments.push({ text: text.slice(lastIndex, start), bold: false })
    if (m[1] !== undefined) {
      segments.push({ text: m[1], bold: true }) // **bold**
    } else {
      segments.push({ text: m[2], bold: false, href: m[3] }) // [label](url)
    }
    lastIndex = start + m[0].length
  }
  if (lastIndex < text.length) segments.push({ text: text.slice(lastIndex), bold: false })
  return segments.filter((seg) => seg.text.length > 0)
}

export async function exportToPdf(text: string, opts: { resume?: boolean } = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 54, size: 'A4' })
    const chunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    if (!opts.resume) {
      doc.font('Helvetica').fontSize(11).text(text, { lineGap: 2 })
      doc.end()
      return
    }

    const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right
    const writeInline = (
      text: string,
      options: PDFKit.Mixins.TextOptions,
      baseFont: 'Helvetica' | 'Helvetica-Bold',
      baseColor: string,
    ) => {
      const segments = inlineSegments(text)
      segments.forEach((seg, index) => {
        const continued = index < segments.length - 1
        if (seg.href) {
          // Clickable hyperlink: blue + underlined, opens on click in the PDF.
          doc
            .font(baseFont)
            .fillColor(`#${LINK_COLOR}`)
            .text(seg.text, { ...options, continued, link: seg.href, underline: true })
        } else {
          doc
            .font(seg.bold ? 'Helvetica-Bold' : baseFont)
            .fillColor(baseColor)
            .text(seg.text, { ...options, continued, link: null, underline: false })
        }
      })
    }

    const lines = text.replace(/\r\n/g, '\n').split('\n')
    let nameRendered = false

    for (const raw of lines) {
      const parsed = classifyLine(raw)
      if (!parsed) {
        doc.moveDown(0.4)
        continue
      }
      if (parsed.kind === 'name' || (!nameRendered && parsed.kind === 'text')) {
        // First line (markdown `# name` or, for legacy, the first text line) is the name.
        doc.font('Helvetica-Bold').fontSize(20).fillColor('#111111').text(parsed.text)
        nameRendered = true
        continue
      }
      nameRendered = true
      if (parsed.kind === 'heading') {
        doc.moveDown(0.7).font('Helvetica-Bold').fontSize(12).fillColor('#111111').text(parsed.text.toUpperCase())
        const ruleY = doc.y + 1
        doc
          .moveTo(doc.page.margins.left, ruleY)
          .lineTo(doc.page.margins.left + contentWidth, ruleY)
          .lineWidth(0.6)
          .strokeColor('#bbbbbb')
          .stroke()
        doc.moveDown(0.35)
        continue
      }
      if (parsed.kind === 'bullet') {
        doc.fillColor('#222222').fontSize(10.5)
        writeInline(`•  ${parsed.text}`, { indent: 12, lineGap: 1.5 }, 'Helvetica', '#222222')
        continue
      }
      doc.fillColor('#111111').fontSize(10.5)
      writeInline(parsed.text, { lineGap: 1.5 }, 'Helvetica', '#111111')
    }

    doc.end()
  })
}

export async function exportToDocx(text: string, opts: { resume?: boolean } = {}): Promise<Buffer> {
  const lines = text.replace(/\r\n/g, '\n').split('\n')

  if (!opts.resume) {
    const paragraphs = lines.map((line) => new Paragraph(line))
    const doc = new Document({ sections: [{ children: paragraphs }] })
    return Packer.toBuffer(doc)
  }

  const runs = (text: string, opts: { bold?: boolean; size?: number; color?: string } = {}) =>
    inlineSegments(text).map((seg) =>
      seg.href
        ? // Clickable hyperlink: blue + underlined, opens on click in Word.
          new ExternalHyperlink({
            link: seg.href,
            children: [new TextRun({ text: seg.text, size: opts.size, color: LINK_COLOR, underline: {} })],
          })
        : new TextRun({ text: seg.text, bold: seg.bold || opts.bold, size: opts.size, color: opts.color }),
    )

  const children: Paragraph[] = []
  let nameRendered = false

  for (const raw of lines) {
    const parsed = classifyLine(raw)
    if (!parsed) {
      children.push(new Paragraph(''))
      continue
    }
    if (parsed.kind === 'name' || (!nameRendered && parsed.kind === 'text')) {
      children.push(new Paragraph({ children: [new TextRun({ text: parsed.text, bold: true, size: 40 })] }))
      nameRendered = true
      continue
    }
    nameRendered = true
    if (parsed.kind === 'heading') {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: runs(parsed.text.toUpperCase(), { bold: true }) }))
      continue
    }
    if (parsed.kind === 'bullet') {
      children.push(new Paragraph({ children: runs(parsed.text), bullet: { level: 0 } }))
      continue
    }
    children.push(new Paragraph({ children: runs(parsed.text) }))
  }

  const doc = new Document({ sections: [{ children }] })
  return Packer.toBuffer(doc)
}
