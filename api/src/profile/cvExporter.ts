import PDFDocument from 'pdfkit'
import type { Profile, Resume, ResumeExperience, ResumeProject, ResumeSkillGroup, ResumeEducation } from '@job-hunter/shared'

const PAGE_MARGIN = 50
const FONT_REGULAR = 'Helvetica'
const FONT_BOLD = 'Helvetica-Bold'
const FONT_ITALIC = 'Helvetica-Oblique'
const RULE_COLOR = '#999999'
const MUTED_COLOR = '#444444'
const TEXT_COLOR = '#111111'

function contentWidth(doc: PDFKit.PDFDocument): number {
  return doc.page.width - PAGE_MARGIN * 2
}

function hasAnyExperience(items: ResumeExperience[]): boolean {
  return items.length > 0
}

function drawRule(doc: PDFKit.PDFDocument) {
  const y = doc.y
  doc
    .strokeColor(RULE_COLOR)
    .lineWidth(0.75)
    .moveTo(PAGE_MARGIN, y)
    .lineTo(PAGE_MARGIN + contentWidth(doc), y)
    .stroke()
}

function sectionHeading(doc: PDFKit.PDFDocument, title: string) {
  doc.moveDown(0.5)
  drawRule(doc)
  doc.moveDown(0.15)
  doc.font(FONT_BOLD).fontSize(11.5).fillColor(TEXT_COLOR).text(title.toUpperCase(), { align: 'center' })
  doc.moveDown(0.15)
  drawRule(doc)
  doc.moveDown(0.4)
}

function renderBullets(doc: PDFKit.PDFDocument, bullets: string[]) {
  doc.font(FONT_REGULAR).fontSize(9.5).fillColor(MUTED_COLOR)
  for (const bullet of bullets) {
    if (!bullet.trim()) continue
    doc.text(`•  ${bullet.trim()}`, PAGE_MARGIN + 10, doc.y, {
      width: contentWidth(doc) - 10,
    })
  }
}

function renderExperience(doc: PDFKit.PDFDocument, entries: ResumeExperience[]) {
  for (const entry of entries) {
    doc.font(FONT_BOLD).fontSize(10.5).fillColor(TEXT_COLOR).text(entry.company)
    const dateRange = `${entry.startDate} - ${entry.endDate ?? 'Present'}`
    doc.font(FONT_ITALIC).fontSize(9.5).fillColor(MUTED_COLOR).text(`${entry.role} (${dateRange})`)
    doc.moveDown(0.15)
    renderBullets(doc, entry.bullets)
    doc.moveDown(0.5)
  }
}

function renderProjects(doc: PDFKit.PDFDocument, entries: ResumeProject[]) {
  for (const entry of entries) {
    doc.font(FONT_BOLD).fontSize(10.5).fillColor(TEXT_COLOR).text(entry.name)
    if (entry.url) {
      doc.font(FONT_REGULAR).fontSize(9).fillColor(MUTED_COLOR).text(entry.url)
    }
    doc.font(FONT_ITALIC).fontSize(9.5).fillColor(MUTED_COLOR).text(entry.role)
    if (entry.technologies.length > 0) {
      doc
        .font(FONT_REGULAR)
        .fontSize(9.5)
        .fillColor(MUTED_COLOR)
        .text(`Technologies: ${entry.technologies.join(' • ')}`)
    }
    doc.moveDown(0.15)
    renderBullets(doc, entry.bullets)
    doc.moveDown(0.5)
  }
}

function renderSkillGroups(doc: PDFKit.PDFDocument, groups: ResumeSkillGroup[]) {
  for (const group of groups) {
    doc
      .font(FONT_REGULAR)
      .fontSize(9.5)
      .fillColor(TEXT_COLOR)
      .text(`${group.category}: `, { continued: true })
      .fillColor(MUTED_COLOR)
      .text(group.skills.join(' • '))
    doc.moveDown(0.2)
  }
}

function renderEducation(doc: PDFKit.PDFDocument, entries: ResumeEducation[]) {
  for (const entry of entries) {
    doc.font(FONT_REGULAR).fontSize(10).fillColor(TEXT_COLOR).text(entry.institution)
    doc.font(FONT_BOLD).fontSize(9.5).fillColor(TEXT_COLOR).text(entry.credential)
    doc.moveDown(0.3)
  }
}

export async function renderResumePdf(profile: Profile): Promise<Buffer> {
  const resume: Resume = profile.resume

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margins: { top: PAGE_MARGIN, bottom: PAGE_MARGIN, left: PAGE_MARGIN, right: PAGE_MARGIN } })
    const chunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const name = resume.fullName ?? profile.email
    doc.font(FONT_BOLD).fontSize(20).fillColor(TEXT_COLOR).text(name, { align: 'center' })

    if (resume.headline) {
      doc.moveDown(0.2)
      doc.font(FONT_REGULAR).fontSize(10.5).fillColor(MUTED_COLOR).text(resume.headline, { align: 'center' })
    }

    const contactParts = [resume.phone, profile.email, ...resume.links].filter(
      (part): part is string => Boolean(part && part.trim())
    )
    if (contactParts.length > 0) {
      doc.moveDown(0.2)
      doc.font(FONT_REGULAR).fontSize(9).fillColor(MUTED_COLOR).text(contactParts.join('  •  '), { align: 'center' })
    }

    if (resume.summary) {
      sectionHeading(doc, 'Summary')
      doc.font(FONT_REGULAR).fontSize(9.5).fillColor(MUTED_COLOR).text(resume.summary, { align: 'left' })
    }

    if (hasAnyExperience(resume.experience)) {
      sectionHeading(doc, 'Experience')
      renderExperience(doc, resume.experience)
    }

    if (resume.projects.length > 0) {
      sectionHeading(doc, 'Projects')
      renderProjects(doc, resume.projects)
    }

    if (resume.skillGroups.length > 0) {
      sectionHeading(doc, 'Skills')
      renderSkillGroups(doc, resume.skillGroups)
    }

    if (resume.education.length > 0) {
      sectionHeading(doc, 'Education')
      renderEducation(doc, resume.education)
    }

    if (
      !resume.summary &&
      !hasAnyExperience(resume.experience) &&
      resume.projects.length === 0 &&
      resume.skillGroups.length === 0 &&
      resume.education.length === 0
    ) {
      doc.moveDown(1)
      doc
        .font(FONT_ITALIC)
        .fontSize(10)
        .fillColor(MUTED_COLOR)
        .text('No resume details added yet — fill in your profile to generate a complete CV.', {
          align: 'center',
        })
      if (profile.cvText) {
        doc.moveDown(1)
        doc.font(FONT_REGULAR).fontSize(9).fillColor(MUTED_COLOR).text(profile.cvText)
      }
    }

    doc.end()
  })
}
