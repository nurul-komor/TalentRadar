import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import mammoth from 'mammoth'

export const DOCX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export type CvParser = (buffer: Buffer, mimeType: string) => Promise<string>

export const parseCvFile: CvParser = async (buffer, mimeType) => {
  if (mimeType === 'application/pdf') {
    return parsePdf(buffer)
  }
  if (mimeType === DOCX_MIME_TYPE) {
    return parseDocx(buffer)
  }
  throw new Error(`unsupported CV mime type: ${mimeType}`)
}

async function parsePdf(buffer: Buffer): Promise<string> {
  // pdf.js takes ownership of the ArrayBuffer backing `data` and detaches it —
  // copy first so the caller's original buffer is never mutated. pdf.js also
  // rejects Node's `Buffer` type outright (even though it's a Uint8Array
  // subclass), so the copy must be a plain Uint8Array.
  const copy = new Uint8Array(buffer)
  const doc = await pdfjsLib.getDocument({ data: copy }).promise

  const pageTexts: string[] = []
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    const page = await doc.getPage(pageNumber)
    const content = await page.getTextContent()
    const pageText = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
    pageTexts.push(pageText)
  }

  return pageTexts.join('\n').trim()
}

async function parseDocx(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer })
  return result.value.trim()
}
