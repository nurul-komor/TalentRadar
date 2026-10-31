import type { Page } from './browser'

export interface DiscoveredField {
  automationId: string
  label: string
}

export interface DiscoveredOptionGroup {
  automationId: string
  legend: string
  kind: 'radio' | 'checkbox'
}

export interface DiscoveredForm {
  textFields: DiscoveredField[]
  textareaFields: DiscoveredField[]
  fileFields: DiscoveredField[]
  optionGroups: DiscoveredOptionGroup[]
}

export async function discoverForm(page: Page): Promise<DiscoveredForm> {
  return page.evaluate(() => {
    let counter = 0
    const nextId = () => `automation-${counter++}`

    function labelFor(el: Element): string {
      const id = el.getAttribute('id')
      if (id) {
        const label = document.querySelector(`label[for="${id}"]`)
        if (label?.textContent) return label.textContent.trim()
      }
      const wrappingLabel = el.closest('label')
      if (wrappingLabel?.textContent) return wrappingLabel.textContent.trim()
      return el.getAttribute('aria-label') ?? ''
    }

    const textFields: { automationId: string; label: string }[] = []
    document
      .querySelectorAll(
        'input[type=text], input[type=email], input[type=tel], input[type=url]'
      )
      .forEach((el: any) => {
        const automationId = nextId()
        el.setAttribute('data-automation-id', automationId)
        textFields.push({ automationId, label: labelFor(el) })
      })

    const textareaFields: { automationId: string; label: string }[] = []
    document.querySelectorAll('textarea').forEach((el: any) => {
      const automationId = nextId()
      el.setAttribute('data-automation-id', automationId)
      textareaFields.push({ automationId, label: labelFor(el) })
    })

    const fileFields: { automationId: string; label: string }[] = []
    document.querySelectorAll('input[type=file]').forEach((el: any) => {
      const automationId = nextId()
      el.setAttribute('data-automation-id', automationId)
      fileFields.push({ automationId, label: labelFor(el) })
    })

    const optionGroups: { automationId: string; legend: string; kind: 'radio' | 'checkbox' }[] = []
    const groupedInputs = new Set<Element>()

    document.querySelectorAll('fieldset').forEach((fieldset: any) => {
      const legend = fieldset.querySelector('legend')?.textContent?.trim() ?? ''
      fieldset
        .querySelectorAll('input[type=radio], input[type=checkbox]')
        .forEach((el: any) => {
          const automationId = nextId()
          el.setAttribute('data-automation-id', automationId)
          optionGroups.push({ automationId, legend, kind: el.type as 'radio' | 'checkbox' })
          groupedInputs.add(el)
        })
    })

    document.querySelectorAll('input[type=checkbox], input[type=radio]').forEach((el: any) => {
      if (groupedInputs.has(el)) return
      const automationId = nextId()
      el.setAttribute('data-automation-id', automationId)
      optionGroups.push({ automationId, legend: labelFor(el), kind: el.type as 'radio' | 'checkbox' })
    })

    return { textFields, textareaFields, fileFields, optionGroups }
  })
}
