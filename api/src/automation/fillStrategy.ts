import type { Materials, Profile } from '@job-hunter/shared'
import { exportToPdf } from '../materials/exporters'
import type { DiscoveredForm } from './formDiscovery'
import type { Page } from './browser'

const CONSENT_PATTERN = /consent|terms|privacy|agree/i
const COVER_LETTER_PATTERN = /cover letter|motivation letter/i
const EMAIL_LABEL_PATTERN = /e-?mail/i

export interface FillOutcome {
  filledFields: Record<string, string>
  requiredAnswers: Array<{ question: string; answer: string | null }>
}

export async function fillForm(
  page: Page,
  form: DiscoveredForm,
  profile: Profile,
  materials: Materials
): Promise<FillOutcome> {
  const filledFields: Record<string, string> = {}
  const requiredAnswers: Array<{ question: string; answer: string | null }> = []

  for (const field of form.textFields) {
    const selector = page.locator(`[data-automation-id="${field.automationId}"]`)
    if (EMAIL_LABEL_PATTERN.test(field.label)) {
      await selector.fill(profile.email)
      filledFields[field.label || field.automationId] = profile.email
    } else {
      requiredAnswers.push({ question: field.label || '(unlabeled text field)', answer: null })
    }
  }

  for (const field of form.textareaFields) {
    const selector = page.locator(`[data-automation-id="${field.automationId}"]`)
    if (COVER_LETTER_PATTERN.test(field.label)) {
      await selector.fill(materials.coverLetter)
      filledFields[field.label] = materials.coverLetter
    } else {
      requiredAnswers.push({ question: field.label || '(unlabeled text area)', answer: null })
    }
  }

  for (const field of form.fileFields) {
    const cvBuffer = await exportToPdf(materials.tailoredCv)
    await page.locator(`[data-automation-id="${field.automationId}"]`).setInputFiles({
      name: 'cv.pdf',
      mimeType: 'application/pdf',
      buffer: cvBuffer,
    })
    filledFields[field.label || field.automationId] = 'cv.pdf'
  }

  const seenLegends = new Set<string>()
  for (const group of form.optionGroups) {
    if (CONSENT_PATTERN.test(group.legend)) {
      continue // never auto-tick consent/terms checkboxes
    }
    if (seenLegends.has(group.legend)) {
      continue // one required-answer entry per legend, not per radio/checkbox input
    }
    seenLegends.add(group.legend)
    requiredAnswers.push({ question: group.legend || '(unlabeled option group)', answer: null })
  }

  return { filledFields, requiredAnswers }
}
