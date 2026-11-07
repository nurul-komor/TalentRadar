import { Icon } from '../components/Icon'
import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { emptyResume } from '@job-hunter/shared'
import type { Profile, Resume } from '@job-hunter/shared'
import { apiFetch, getToken } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { FormError } from '../components/FormError'
import { ThemeToggle } from '../components/ThemeToggle'
import {
  EducationEntryFields,
  ExperienceEntryFields,
  RepeatableSection,
  SkillGroupEntryFields,
  appendEntry,
  removeEntryAt,
  sanitizeResumeForSave,
  updateEntryAt,
} from '../components/resumeFields'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const ACCEPTED_MIME_TYPES = new Set(['application/pdf', DOCX_MIME_TYPE])
const MAX_CV_FILE_BYTES = 10 * 1024 * 1024

const STEPS = ['Personal', 'CV', 'Links', 'Experience', 'Education', 'Skills', 'Review'] as const

async function uploadCv(file: File): Promise<Profile> {
  const formData = new FormData()
  formData.append('file', file)
  const token = getToken()
  const headers = new Headers()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787'
  const res = await fetch(`${apiBaseUrl}/profile/cv`, { method: 'POST', headers, body: formData })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.error ?? 'Failed to parse CV.')
  }
  return res.json()
}

export function OnboardingPage() {
  const navigate = useNavigate()
  const { refreshProfile, skipOnboarding } = useAuth()
  const [step, setStep] = useState(0)
  const [email, setEmail] = useState('')
  const [resume, setResume] = useState<Resume>(emptyResume)
  const [cvText, setCvText] = useState<string | null>(null)
  const [cvUploading, setCvUploading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stepError, setStepError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    apiFetch('/profile').then(async (res) => {
      if (!res.ok) {
        setError('Failed to load your profile.')
        setLoaded(true)
        return
      }
      const data: Profile = await res.json()
      // A user who already finished onboarding shouldn't see the wizard again.
      if (data.onboardingCompletedAt) {
        navigate('/jobs', { replace: true })
        return
      }
      setEmail(data.email)
      setResume({ ...emptyResume(), ...data.resume })
      setCvText(data.cvText)
      setLoaded(true)
    })
  }, [navigate])

  function patchResume(patch: Partial<Resume>) {
    setResume((prev) => ({ ...prev, ...patch }))
    setStepError(null)
  }

  function handleCvFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!ACCEPTED_MIME_TYPES.has(file.type)) {
      setStepError('Unsupported file type. Upload a PDF or DOCX.')
      return
    }
    if (file.size > MAX_CV_FILE_BYTES) {
      setStepError('File is too large. Maximum size is 10MB.')
      return
    }
    setStepError(null)
    setCvUploading(true)
    uploadCv(file)
      .then((updated) => {
        setCvText(updated.cvText)
        // CV parsing may have auto-filled a structured resume — merge it in so
        // later steps (experience, education, skills) start pre-populated.
        if (updated.resume) setResume((prev) => ({ ...prev, ...updated.resume }))
      })
      .catch((err: Error) => setStepError(err.message))
      .finally(() => setCvUploading(false))
  }

  // Each step gates "Continue" until its required fields are filled. Returns an
  // error message when the step is incomplete, or null when it's good to go.
  function validateStep(index: number): string | null {
    switch (STEPS[index]) {
      case 'Personal':
        if (!resume.fullName?.trim()) return 'Full name is required.'
        if (!resume.phone?.trim()) return 'Phone number is required.'
        if (!resume.location.country?.trim()) return 'Country is required.'
        if (!resume.location.city?.trim()) return 'City is required.'
        return null
      case 'Links':
        if (!resume.linkedin?.trim()) return 'LinkedIn profile is required.'
        if (!resume.github?.trim()) return 'A portfolio or GitHub profile is required.'
        return null
      case 'CV':
        if (!cvText) return 'Please upload your CV to continue.'
        return null
      case 'Experience':
        if (resume.experience.length === 0) return 'Add at least one work experience.'
        if (resume.experience.some((e) => !e.company.trim() || !e.role.trim()))
          return 'Each experience needs a company and role.'
        return null
      case 'Education':
        if (resume.education.length === 0) return 'Add at least one education entry.'
        if (resume.education.some((e) => !e.institution.trim() || !e.credential.trim()))
          return 'Each education entry needs an institution and credential.'
        return null
      case 'Skills':
        if (resume.skillGroups.length === 0) return 'Add at least one skill group.'
        if (resume.skillGroups.some((g) => !g.category.trim() || g.skills.length === 0))
          return 'Each skill group needs a category and at least one skill.'
        return null
      default:
        return null
    }
  }

  function goNext() {
    const message = validateStep(step)
    if (message) {
      setStepError(message)
      return
    }
    setStepError(null)
    setStep((s) => Math.min(s + 1, STEPS.length - 1))
  }

  function goBack() {
    setStepError(null)
    setStep((s) => Math.max(s - 1, 0))
  }

  // "Skip for now" advances past the current step without validating it, so a
  // user can skip steps one at a time. On the final step there's nothing left to
  // skip, so it leaves onboarding entirely — they can finish later from Profile,
  // and applying to a job routes them back here until it's done.
  function handleSkip() {
    if (step < STEPS.length - 1) {
      setStepError(null)
      setStep((s) => s + 1)
      return
    }
    skipOnboarding()
    navigate('/jobs', { replace: true })
  }

  async function finish() {
    // Re-validate every step so no required field can slip through if the user
    // jumped around — the Review step is the last gate before we persist.
    for (let i = 0; i < STEPS.length; i++) {
      const message = validateStep(i)
      if (message) {
        setStep(i)
        setStepError(message)
        return
      }
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await apiFetch('/profile', {
        method: 'PUT',
        body: JSON.stringify({
          resume: sanitizeResumeForSave(resume),
          onboardingCompletedAt: new Date().toISOString(),
        }),
      })
      if (!res.ok) {
        setError('Failed to save your profile. Please try again.')
        return
      }
      await refreshProfile()
      navigate('/jobs', { replace: true })
    } catch {
      setError('Could not reach the server. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (!loaded) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
        Loading…
      </div>
    )
  }

  const current = STEPS[step]

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-3xl items-start justify-between gap-4 px-6 py-10">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-primary">Set up your profile</div>
            <h1 className="mt-2 text-2xl font-bold text-foreground sm:text-3xl">
              Welcome — let&apos;s finish your profile
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              These details power job matching and your AI-generated resume and cover letters.
            </p>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-6 pb-16">
        {error && (
          <div className="mt-6">
            <FormError message={error} />
          </div>
        )}

        <ol className="mt-6 flex flex-wrap gap-2" aria-label="Onboarding progress">
          {STEPS.map((label, index) => (
            <li
              key={label}
              aria-current={index === step ? 'step' : undefined}
              className={cn(
                'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium',
                index === step
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground'
              )}
            >
              <span
                className={cn(
                  'flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold',
                  index === step
                    ? 'bg-primary text-primary-foreground'
                    : index < step
                      ? 'bg-primary/20 text-primary'
                      : 'bg-muted text-muted-foreground'
                )}
              >
                {index < step ? '✓' : index + 1}
              </span>
              {label}
            </li>
          ))}
        </ol>

        <section className="mt-5 rounded-2xl border border-border bg-card p-6">
          {current === 'Personal' && (
            <>
              <h2 className="text-lg font-semibold text-foreground">Personal details</h2>
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="onb-email">Email</Label>
                  <Input id="onb-email" value={email} readOnly disabled />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="onb-fullName">Full name</Label>
                  <Input
                    id="onb-fullName"
                    value={resume.fullName ?? ''}
                    placeholder="Jane Doe"
                    onChange={(e) => patchResume({ fullName: e.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="onb-phone">Phone number</Label>
                  <Input
                    id="onb-phone"
                    value={resume.phone ?? ''}
                    placeholder="+1 555 123 4567"
                    onChange={(e) => patchResume({ phone: e.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="onb-country">Country</Label>
                  <Input
                    id="onb-country"
                    value={resume.location.country ?? ''}
                    placeholder="Bangladesh"
                    onChange={(e) => patchResume({ location: { ...resume.location, country: e.target.value } })}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="onb-city">City</Label>
                  <Input
                    id="onb-city"
                    value={resume.location.city ?? ''}
                    placeholder="Dhaka"
                    onChange={(e) => patchResume({ location: { ...resume.location, city: e.target.value } })}
                  />
                </div>
              </div>
            </>
          )}

          {current === 'Links' && (
            <>
              <h2 className="text-lg font-semibold text-foreground">Professional links</h2>
              <div className="mt-4 grid grid-cols-1 gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="onb-linkedin">LinkedIn profile</Label>
                  <Input
                    id="onb-linkedin"
                    value={resume.linkedin ?? ''}
                    placeholder="https://linkedin.com/in/you"
                    onChange={(e) => patchResume({ linkedin: e.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="onb-github">Portfolio / GitHub profile</Label>
                  <Input
                    id="onb-github"
                    value={resume.github ?? ''}
                    placeholder="https://github.com/you"
                    onChange={(e) => patchResume({ github: e.target.value })}
                  />
                </div>
              </div>
            </>
          )}

          {current === 'CV' && (
            <>
              <h2 className="text-lg font-semibold text-foreground">Upload your CV</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                PDF or DOCX, up to 10MB. We&apos;ll extract the text and try to pre-fill the next steps.
              </p>
              <div className="mt-5 flex flex-wrap items-center gap-4">
                <Button type="button" onClick={() => fileInputRef.current?.click()} disabled={cvUploading}>
                  {cvUploading ? 'Parsing…' : cvText ? 'Replace CV' : 'Browse files'}
                </Button>
                {cvText && !cvUploading && (
                  <span className="inline-flex items-center gap-1.5 text-sm font-medium text-primary">
                    <Icon name="checkmark-circle-outline" /> CV on file ({cvText.length.toLocaleString()} chars)
                  </span>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.docx"
                  onChange={handleCvFile}
                  className="hidden"
                />
              </div>
            </>
          )}

          {current === 'Experience' && (
            <>
              <h2 className="mb-4 text-lg font-semibold text-foreground">Work experience</h2>
              <RepeatableSection
                addLabel="Add experience"
                onAdd={() =>
                  patchResume({
                    experience: appendEntry(resume.experience, {
                      company: '',
                      role: '',
                      startDate: '',
                      endDate: null,
                      bullets: [],
                    }),
                  })
                }
              >
                {resume.experience.map((entry, index) => (
                  <ExperienceEntryFields
                    key={index}
                    entry={entry}
                    index={index}
                    onChange={(i, patch) => patchResume({ experience: updateEntryAt(resume.experience, i, patch) })}
                    onRemove={(i) => patchResume({ experience: removeEntryAt(resume.experience, i) })}
                  />
                ))}
              </RepeatableSection>
            </>
          )}

          {current === 'Education' && (
            <>
              <h2 className="mb-4 text-lg font-semibold text-foreground">Education</h2>
              <RepeatableSection
                addLabel="Add education"
                onAdd={() =>
                  patchResume({ education: appendEntry(resume.education, { institution: '', credential: '' }) })
                }
              >
                {resume.education.map((entry, index) => (
                  <EducationEntryFields
                    key={index}
                    entry={entry}
                    index={index}
                    onChange={(i, patch) => patchResume({ education: updateEntryAt(resume.education, i, patch) })}
                    onRemove={(i) => patchResume({ education: removeEntryAt(resume.education, i) })}
                  />
                ))}
              </RepeatableSection>
            </>
          )}

          {current === 'Skills' && (
            <>
              <h2 className="mb-4 text-lg font-semibold text-foreground">Skills</h2>
              <RepeatableSection
                addLabel="Add skill group"
                onAdd={() =>
                  patchResume({ skillGroups: appendEntry(resume.skillGroups, { category: '', skills: [] }) })
                }
              >
                {resume.skillGroups.map((entry, index) => (
                  <SkillGroupEntryFields
                    key={index}
                    entry={entry}
                    index={index}
                    onChange={(i, patch) => patchResume({ skillGroups: updateEntryAt(resume.skillGroups, i, patch) })}
                    onRemove={(i) => patchResume({ skillGroups: removeEntryAt(resume.skillGroups, i) })}
                  />
                ))}
              </RepeatableSection>
            </>
          )}

          {current === 'Review' && (
            <>
              <h2 className="text-lg font-semibold text-foreground">Review</h2>
              <dl className="mt-4 divide-y divide-border rounded-xl border border-border">
                {(
                  [
                    ['Name', resume.fullName],
                    ['Email', email],
                    ['Phone', resume.phone],
                    ['Location', [resume.location.city, resume.location.country].filter(Boolean).join(', ')],
                    ['LinkedIn', resume.linkedin],
                    ['Portfolio / GitHub', resume.github],
                    ['CV', cvText ? 'Uploaded' : 'Missing'],
                    ['Experience', `${resume.experience.length} ${resume.experience.length === 1 ? 'entry' : 'entries'}`],
                    ['Education', `${resume.education.length} ${resume.education.length === 1 ? 'entry' : 'entries'}`],
                    [
                      'Skills',
                      `${resume.skillGroups.reduce((n, g) => n + g.skills.length, 0)} across ${resume.skillGroups.length} group${resume.skillGroups.length === 1 ? '' : 's'}`,
                    ],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between gap-4 px-4 py-2.5 text-sm">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="text-right font-medium text-foreground">{value || '—'}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-sm text-muted-foreground">
                You can edit any of this later from your Profile page.
              </p>
            </>
          )}

          {stepError && <p className="mt-4 text-sm text-destructive">{stepError}</p>}

          <div className="mt-6 flex items-center justify-between gap-3">
            <Button type="button" variant="ghost" onClick={goBack} disabled={step === 0}>
              Back
            </Button>
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" onClick={handleSkip}>
                Skip for now
              </Button>
              {current === 'Review' ? (
                <Button type="button" onClick={finish} disabled={submitting}>
                  {submitting ? 'Finishing…' : 'Finish setup'}
                </Button>
              ) : (
                <Button type="button" onClick={goNext} disabled={cvUploading}>
                  Continue
                </Button>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
