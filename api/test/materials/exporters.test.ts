import { describe, it, expect } from 'vitest'
import { exportToPdf, exportToDocx, inlineSegments } from '../../src/materials/exporters'

describe('inlineSegments', () => {
  it('splits a line into bold, link, and plain segments', () => {
    const segments = inlineSegments('**Weather App** — a demo [(Visit)](https://weather.example.com) today')
    expect(segments).toEqual([
      { text: 'Weather App', bold: true },
      { text: ' — a demo ', bold: false },
      { text: '(Visit)', bold: false, href: 'https://weather.example.com' },
      { text: ' today', bold: false },
    ])
  })

  it('treats plain text with no markers as a single segment', () => {
    expect(inlineSegments('just text')).toEqual([{ text: 'just text', bold: false }])
  })
})

describe('exportToPdf', () => {
  it('produces a non-empty buffer starting with the PDF file signature', async () => {
    const buffer = await exportToPdf('Hello, this is a tailored cover letter.\nSecond line.')
    expect(buffer.length).toBeGreaterThan(0)
    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-')
  })

  it('embeds a project live link as a clickable URL annotation', async () => {
    const cv = `# Jane Doe
Android Developer

## Projects
**Weather App** — a demo [(Visit)](https://weather.example.com)
- Shipped offline sync serving 5,000+ daily users`
    const buffer = await exportToPdf(cv, { resume: true })
    // The link URI lives in an (uncompressed) annotation dictionary, so the URL
    // appears verbatim in the PDF bytes even though the visible text is compressed.
    expect(buffer.toString('latin1')).toContain('https://weather.example.com')
  })
})

describe('exportToDocx', () => {
  it('produces a non-empty buffer starting with the ZIP file signature docx uses', async () => {
    const buffer = await exportToDocx('Hello, this is a tailored cover letter.\nSecond line.')
    expect(buffer.length).toBeGreaterThan(0)
    expect(buffer[0]).toBe(0x50) // 'P'
    expect(buffer[1]).toBe(0x4b) // 'K' — DOCX files are ZIP archives (PK magic bytes)
  })
})
