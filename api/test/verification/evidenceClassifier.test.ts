import { describe, it, expect } from 'vitest'
import { classifyEvidence, stripHtmlToText } from '../../src/verification/evidenceClassifier'

describe('classifyEvidence', () => {
  it('classifies positive evidence as verified', () => {
    const result = classifyEvidence('Join our team! Apply now to get started.')
    expect(result).toEqual({ status: 'verified', evidence: 'apply now' })
  })

  it('classifies negative evidence as rejected', () => {
    const result = classifyEvidence('Thank you for your interest — this position has been filled.')
    expect(result).toEqual({ status: 'rejected', evidence: 'position has been filled' })
  })

  it('prefers negative evidence over positive evidence when both are present', () => {
    const result = classifyEvidence(
      'This position has been filled. You can still apply now to similar roles.'
    )
    expect(result).toEqual({ status: 'rejected', evidence: 'position has been filled' })
  })

  it('classifies as inconclusive when no evidence pattern matches', () => {
    const result = classifyEvidence('A generic page with no hiring language at all.')
    expect(result).toEqual({ status: 'inconclusive', evidence: null })
  })
})

describe('stripHtmlToText', () => {
  it('removes script and style blocks entirely, strips remaining tags, and collapses whitespace', () => {
    const html =
      '<html><head><style>.x{color:red}</style></head>' +
      '<body><script>var x=1;</script><h1>Apply   Now</h1><p>Join us!</p></body></html>'
    const text = stripHtmlToText(html)
    expect(text).not.toContain('color:red')
    expect(text).not.toContain('var x=1')
    expect(text).toContain('Apply Now')
    expect(text).toContain('Join us!')
  })
})
