import PDFDocument from 'pdfkit'
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx'

// The tailored CV is generated as GitHub-flavored Markdown. These helpers parse
// the small subset it uses — `# name`, `## section`, `- bullet`, `**bold**` — so
// the PDF/DOCX come out formatted rather than showing literal markdown markers.
// Legacy records (plain UPPERCASE headings, no markdown) are still handled.

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
  text: string // markdown markers for structure stripped; inline **bold** preserved
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

// Splits a line into alternating normal / bold (**…**) segments.
function inlineSegments(text: string): Array<{ text: string; bold: boolean }> {
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .filter((part) => part.length > 0)
    .map((part) =>
      part.startsWith('**') && part.endsWith('**')
        ? { text: part.slice(2, -2), bold: true }
        : { text: part, bold: false },
    )
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
    const writeInline = (text: string, options: PDFKit.Mixins.TextOptions, baseFont: 'Helvetica' | 'Helvetica-Bold') => {
      const segments = inlineSegments(text)
      segments.forEach((seg, index) => {
        doc
          .font(seg.bold ? 'Helvetica-Bold' : baseFont)
          .text(seg.text, { ...options, continued: index < segments.length - 1 })
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
        writeInline(`•  ${parsed.text}`, { indent: 12, lineGap: 1.5 }, 'Helvetica')
        continue
      }
      doc.fillColor('#111111').fontSize(10.5)
      writeInline(parsed.text, { lineGap: 1.5 }, 'Helvetica')
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
    inlineSegments(text).map(
      (seg) => new TextRun({ text: seg.text, bold: seg.bold || opts.bold, size: opts.size, color: opts.color }),
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
