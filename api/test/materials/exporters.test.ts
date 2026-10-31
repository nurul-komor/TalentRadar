import { describe, it, expect } from 'vitest'
import { exportToPdf, exportToDocx } from '../../src/materials/exporters'

describe('exportToPdf', () => {
  it('produces a non-empty buffer starting with the PDF file signature', async () => {
    const buffer = await exportToPdf('Hello, this is a tailored cover letter.\nSecond line.')
    expect(buffer.length).toBeGreaterThan(0)
    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-')
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
