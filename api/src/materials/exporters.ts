import PDFDocument from 'pdfkit'
import { Document, Packer, Paragraph } from 'docx'

export async function exportToPdf(text: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument()
    const chunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    doc.text(text)
    doc.end()
  })
}

export async function exportToDocx(text: string): Promise<Buffer> {
  const paragraphs = text.split('\n').map((line) => new Paragraph(line))
  const doc = new Document({ sections: [{ children: paragraphs }] })
  return Packer.toBuffer(doc)
}
