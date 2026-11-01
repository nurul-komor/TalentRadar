import { describe, it, expect } from 'vitest'
import type { Profile } from '@job-hunter/shared'
import { emptyResume } from '@job-hunter/shared'
import { renderResumePdf } from '../../src/profile/cvExporter'

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    email: 'person@example.com',
    eligibility: { workAuthorization: 'unknown', countries: [] },
    preferences: { targetRoles: [], remoteOnly: true, minSalaryUsd: null, locations: [] },
    cvText: null,
    resume: emptyResume(),
    ...overrides,
  }
}

describe('renderResumePdf', () => {
  it('renders a valid PDF for a profile with no resume content filled in', async () => {
    const buffer = await renderResumePdf(makeProfile())
    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-')
  })

  it('renders a valid PDF for a fully filled-in resume', async () => {
    const buffer = await renderResumePdf(
      makeProfile({
        resume: {
          fullName: 'Nurul Komor',
          headline: 'Full-Stack Developer | Web Applications & Workflow Automation',
          phone: '+8801860081978',
          links: ['github.com/nurul-komor'],
          summary: 'Full-stack software engineer experienced in building web applications.',
          experience: [
            {
              company: 'wOow Global',
              role: 'Software Engineer',
              startDate: '03/2024',
              endDate: null,
              bullets: ['Built an automation system that reduced processing time by 80%.'],
            },
          ],
          projects: [
            {
              name: 'wOow CRM',
              url: null,
              role: 'Full Stack Engineer',
              technologies: ['Laravel', 'React.js'],
              bullets: ['Developed lead-management and assignment workflows.'],
            },
          ],
          skillGroups: [{ category: 'Programming Languages', skills: ['PHP', 'TypeScript'] }],
          education: [{ institution: 'East Delta University', credential: 'BSc in Computer Science' }],
        },
      })
    )
    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-')
    expect(buffer.byteLength).toBeGreaterThan(500)
  })

  it('falls back to the raw uploaded CV text when no resume content is filled in', async () => {
    const buffer = await renderResumePdf(makeProfile({ cvText: 'Raw parsed CV text from upload.' }))
    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-')
  })
})
