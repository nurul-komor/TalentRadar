import { describe, it, expect, vi, afterEach } from 'vitest'

const mockGetDocument = vi.fn()
const mockExtractRawText = vi.fn()

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  getDocument: mockGetDocument,
}))

vi.mock('mammoth', () => ({
  default: { extractRawText: mockExtractRawText },
}))

describe('parseCvFile', () => {
  afterEach(() => {
    mockGetDocument.mockReset()
    mockExtractRawText.mockReset()
  })

  it('extracts and joins text from every page of a PDF, in page order', async () => {
    const fakeDoc = {
      numPages: 2,
      getPage: vi.fn(async (pageNumber: number) => ({
        getTextContent: vi.fn(async () => ({
          items:
            pageNumber === 1
              ? [{ str: 'Page one.' }, { str: 'More text.' }]
              : [{ str: 'Page two.' }],
        })),
      })),
    }
    mockGetDocument.mockReturnValue({ promise: Promise.resolve(fakeDoc) })

    const { parseCvFile } = await import('../../src/profile/cvParser')
    const text = await parseCvFile(Buffer.from('fake pdf bytes'), 'application/pdf')

    expect(text).toBe('Page one. More text.\nPage two.')
  })

  it('passes a copy of the buffer to pdf.js, never the original reference', async () => {
    const fakeDoc = { numPages: 0, getPage: vi.fn() }
    mockGetDocument.mockReturnValue({ promise: Promise.resolve(fakeDoc) })

    const { parseCvFile } = await import('../../src/profile/cvParser')
    const originalBuffer = Buffer.from('fake pdf bytes')
    await parseCvFile(originalBuffer, 'application/pdf')

    const passedData = mockGetDocument.mock.calls[0][0].data
    expect(passedData).not.toBe(originalBuffer)
    expect(Buffer.compare(passedData, originalBuffer)).toBe(0)
  })

  it('extracts and trims text from a DOCX file via mammoth, passing a buffer not a path', async () => {
    mockExtractRawText.mockResolvedValue({ value: '  Resume text here.  ' })

    const { parseCvFile } = await import('../../src/profile/cvParser')
    const text = await parseCvFile(
      Buffer.from('fake docx bytes'),
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )

    expect(text).toBe('Resume text here.')
    expect(mockExtractRawText).toHaveBeenCalledWith({ buffer: expect.any(Buffer) })
  })

  it('throws for an unsupported mime type', async () => {
    const { parseCvFile } = await import('../../src/profile/cvParser')
    await expect(parseCvFile(Buffer.from('x'), 'image/png')).rejects.toThrow(
      'unsupported CV mime type'
    )
  })
})
