// pdf.js, its worker, and mammoth are large (several MB) and only needed when a
// CV is actually uploaded — never on a normal request. They're imported lazily
// inside parsePdf/parseDocx so they stay out of the serverless cold-start path.
// This also keeps importing the lightweight `DOCX_MIME_TYPE` constant below (done
// by routes/materials.ts) from dragging the whole PDF/DOCX toolchain into memory.
let pdfjsLibPromise: Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> | null = null

async function loadPdfjs(): Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = (async () => {
      const [pdfjsLib, pdfjsWorker] = await Promise.all([
        import('pdfjs-dist/legacy/build/pdf.mjs'),
        import('pdfjs-dist/legacy/build/pdf.worker.mjs'),
      ])
      // Run pdf.js entirely on the main thread. By default pdf.js loads its worker
      // via a dynamic `import(workerSrc)`, which the Vercel/esbuild bundler can't see
      // statically — so the worker module isn't included in the serverless function
      // bundle and `getDocument()` throws at runtime (works locally, fails deployed).
      // Registering the imported worker on `globalThis.pdfjsWorker` makes pdf.js use
      // its `WorkerMessageHandler` directly and skip the dynamic import.
      ;(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = pdfjsWorker
      return pdfjsLib
    })()
  }
  return pdfjsLibPromise
}

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
  const pdfjsLib = await loadPdfjs()
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
  const { default: mammoth } = await import('mammoth')
  const result = await mammoth.extractRawText({ buffer })
  return result.value.trim()
}
