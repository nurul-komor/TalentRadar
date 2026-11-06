import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { emptyResume } from '@job-hunter/shared'
import type { Eligibility, Profile, Resume } from '@job-hunter/shared'
import { apiFetch } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { FormError } from '../components/FormError'
import { ScoreRing } from '../components/ScoreRing'
import {
  EducationEntryFields,
  ExperienceEntryFields,
  ProjectEntryFields,
  RepeatableSection,
  SkillGroupEntryFields,
  TagList,
  appendEntry,
  removeEntryAt,
  sanitizeResumeForSave,
  updateEntryAt,
} from '../components/resumeFields'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

type WorkAuthorization = Eligibility['workAuthorization']

const WORK_AUTH_OPTIONS: Array<{ value: WorkAuthorization; label: string }> = [
  { value: 'unknown', label: 'Not specified' },
  { value: 'citizen', label: 'Citizen' },
  { value: 'permanent_resident', label: 'Permanent resident' },
  { value: 'visa_required', label: 'Visa required' },
]

// Mirrors the required-field set the onboarding wizard enforces. Used both for
// the completeness checklist and to flip onboardingCompletedAt once satisfied.
function requiredChecks(resume: Resume, cvText: string | null) {
  return [
    { key: 'fullName', label: 'Full name', done: !!resume.fullName?.trim() },
    { key: 'phone', label: 'Phone number', done: !!resume.phone?.trim() },
    { key: 'country', label: 'Country', done: !!resume.location.country?.trim() },
    { key: 'city', label: 'City', done: !!resume.location.city?.trim() },
    { key: 'linkedin', label: 'LinkedIn profile', done: !!resume.linkedin?.trim() },
    { key: 'github', label: 'Portfolio / GitHub', done: !!resume.github?.trim() },
    { key: 'cv', label: 'CV uploaded', done: cvText != null },
    { key: 'experience', label: 'Work experience', done: resume.experience.length > 0 },
    { key: 'education', label: 'Education', done: resume.education.length > 0 },
    {
      key: 'skills',
      label: 'Skills',
      done: resume.skillGroups.some((g) => g.skills.length > 0),
    },
  ]
}

const selectClass =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-6">
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  )
}

export function ProfilePage() {
  const { refreshProfile } = useAuth()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [resume, setResume] = useState<Resume>(emptyResume)
  const [workAuthorization, setWorkAuthorization] = useState<WorkAuthorization>('unknown')
  const [countries, setCountries] = useState<string[]>([])
  const [targetRoles, setTargetRoles] = useState<string[]>([])
  const [locations, setLocations] = useState<string[]>([])
  const [remoteOnly, setRemoteOnly] = useState(true)
  const [minSalaryUsd, setMinSalaryUsd] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [generatingCv, setGeneratingCv] = useState(false)
  const [cvExportError, setCvExportError] = useState<string | null>(null)

  useEffect(() => {
    apiFetch('/profile').then(async (res) => {
      if (!res.ok) {
        setError('Failed to load profile.')
        return
      }
      const data: Profile = await res.json()
      setProfile(data)
      setResume({ ...emptyResume(), ...data.resume })
      setWorkAuthorization(data.eligibility.workAuthorization)
      setCountries(data.eligibility.countries)
      setTargetRoles(data.preferences.targetRoles)
      setLocations(data.preferences.locations)
      setRemoteOnly(data.preferences.remoteOnly)
      setMinSalaryUsd(data.preferences.minSalaryUsd?.toString() ?? '')
    })
  }, [])

  function patchResume(patch: Partial<Resume>) {
    setResume((prev) => ({ ...prev, ...patch }))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSaved(false)
    setSaving(true)
    try {
      const clean = sanitizeResumeForSave(resume)
      const checks = requiredChecks(clean, profile?.cvText ?? null)
      const allComplete = checks.every((c) => c.done)
      const body: Record<string, unknown> = {
        resume: clean,
        eligibility: { workAuthorization, countries },
        preferences: {
          targetRoles,
          locations,
          remoteOnly,
          minSalaryUsd: minSalaryUsd ? Number(minSalaryUsd) : null,
        },
      }
      // Finishing the required set here counts as completing onboarding, so a
      // user who skipped the wizard isn't bounced back when they try to apply.
      if (allComplete && !profile?.onboardingCompletedAt) {
        body.onboardingCompletedAt = new Date().toISOString()
      }
      const res = await apiFetch('/profile', { method: 'PUT', body: JSON.stringify(body) })
      if (!res.ok) {
        setError('Failed to save profile.')
        return
      }
      setProfile(await res.json())
      setSaved(true)
      await refreshProfile()
    } finally {
      setSaving(false)
    }
  }

  async function handleGenerateCv() {
    setCvExportError(null)
    setGeneratingCv(true)
    try {
      const res = await apiFetch('/profile/cv/export')
      if (!res.ok) {
        setCvExportError('Failed to generate CV.')
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'cv.pdf'
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch {
      setCvExportError('Failed to generate CV.')
    } finally {
      setGeneratingCv(false)
    }
  }

  const hasCv = profile?.cvText != null
  const checks = requiredChecks(resume, profile?.cvText ?? null)
  const completeness = Math.round((checks.filter((c) => c.done).length / checks.length) * 100)

  return (
    <div>
      <header className="border-b border-border">
        <div className="mx-auto max-w-5xl px-6 py-10">
          <div className="text-xs font-semibold uppercase tracking-wider text-primary">Account</div>
          <h1 className="mt-2 text-2xl font-bold text-foreground sm:text-3xl">Profile</h1>
          <p className="mt-2 text-sm text-muted-foreground">{profile?.email ?? 'Loading…'}</p>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-6 pb-16">
        {error && (
          <div className="mt-6">
            <FormError message={error} />
          </div>
        )}

        {!profile ? (
          <p className="mt-8 text-muted-foreground">Loading…</p>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
            <div className="flex flex-col gap-6">
              <Section title="Personal details">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="pf-email">Email</Label>
                    <Input id="pf-email" value={profile.email} readOnly disabled />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="pf-fullName">Full name</Label>
                    <Input
                      id="pf-fullName"
                      value={resume.fullName ?? ''}
                      placeholder="Jane Doe"
                      onChange={(e) => patchResume({ fullName: e.target.value })}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="pf-phone">Phone number</Label>
                    <Input
                      id="pf-phone"
                      value={resume.phone ?? ''}
                      placeholder="+1 555 123 4567"
                      onChange={(e) => patchResume({ phone: e.target.value })}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="pf-headline">Headline</Label>
                    <Input
                      id="pf-headline"
                      value={resume.headline ?? ''}
                      placeholder="Senior Backend Engineer"
                      onChange={(e) => patchResume({ headline: e.target.value })}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="pf-country">Country</Label>
                    <Input
                      id="pf-country"
                      value={resume.location.country ?? ''}
                      placeholder="Bangladesh"
                      onChange={(e) => patchResume({ location: { ...resume.location, country: e.target.value } })}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="pf-city">City</Label>
                    <Input
                      id="pf-city"
                      value={resume.location.city ?? ''}
                      placeholder="Dhaka"
                      onChange={(e) => patchResume({ location: { ...resume.location, city: e.target.value } })}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5 sm:col-span-2">
                    <Label htmlFor="pf-summary">Professional summary</Label>
                    <Textarea
                      id="pf-summary"
                      value={resume.summary ?? ''}
                      placeholder="A short paragraph about your experience and strengths."
                      onChange={(e) => patchResume({ summary: e.target.value })}
                    />
                  </div>
                </div>
              </Section>

              <Section title="Professional links">
                <div className="grid grid-cols-1 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="pf-linkedin">LinkedIn profile</Label>
                    <Input
                      id="pf-linkedin"
                      value={resume.linkedin ?? ''}
                      placeholder="https://linkedin.com/in/you"
                      onChange={(e) => patchResume({ linkedin: e.target.value })}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="pf-github">Portfolio / GitHub profile</Label>
                    <Input
                      id="pf-github"
                      value={resume.github ?? ''}
                      placeholder="https://github.com/you"
                      onChange={(e) => patchResume({ github: e.target.value })}
                    />
                  </div>
                </div>
              </Section>

              <Section title="Work experience">
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
              </Section>

              <Section title="Education">
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
              </Section>

              <Section title="Skills">
                <RepeatableSection
                  addLabel="Add skill group"
                  onAdd={() => patchResume({ skillGroups: appendEntry(resume.skillGroups, { category: '', skills: [] }) })}
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
              </Section>

              <Section title="Projects">
                <RepeatableSection
                  addLabel="Add project"
                  onAdd={() =>
                    patchResume({
                      projects: appendEntry(resume.projects, {
                        name: '',
                        url: null,
                        role: '',
                        technologies: [],
                        bullets: [],
                      }),
                    })
                  }
                >
                  {resume.projects.map((entry, index) => (
                    <ProjectEntryFields
                      key={index}
                      entry={entry}
                      index={index}
                      onChange={(i, patch) => patchResume({ projects: updateEntryAt(resume.projects, i, patch) })}
                      onRemove={(i) => patchResume({ projects: removeEntryAt(resume.projects, i) })}
                    />
                  ))}
                </RepeatableSection>
              </Section>

              <Section title="Eligibility">
                <div className="grid grid-cols-1 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="pf-workAuth">Work authorization</Label>
                    <select
                      id="pf-workAuth"
                      className={selectClass}
                      value={workAuthorization}
                      onChange={(e) => setWorkAuthorization(e.target.value as WorkAuthorization)}
                    >
                      {WORK_AUTH_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>Eligible countries</Label>
                    <TagList
                      items={countries}
                      placeholder="Add a country"
                      onAdd={(value) => setCountries((prev) => [...prev, value])}
                      onRemove={(index) => setCountries((prev) => prev.filter((_, i) => i !== index))}
                    />
                  </div>
                </div>
              </Section>

              <Section title="Job preferences">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5 sm:col-span-2">
                    <Label>Target roles</Label>
                    <TagList
                      items={targetRoles}
                      placeholder="Add a role"
                      onAdd={(value) => setTargetRoles((prev) => [...prev, value])}
                      onRemove={(index) => setTargetRoles((prev) => prev.filter((_, i) => i !== index))}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5 sm:col-span-2">
                    <Label>Preferred locations</Label>
                    <TagList
                      items={locations}
                      placeholder="Add a location"
                      onAdd={(value) => setLocations((prev) => [...prev, value])}
                      onRemove={(index) => setLocations((prev) => prev.filter((_, i) => i !== index))}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="pf-minSalary">Minimum salary (USD)</Label>
                    <Input
                      id="pf-minSalary"
                      type="number"
                      min={0}
                      value={minSalaryUsd}
                      placeholder="e.g. 80000"
                      onChange={(e) => setMinSalaryUsd(e.target.value)}
                    />
                  </div>
                  <label className="flex items-center gap-2.5 sm:mt-7">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={remoteOnly}
                      onChange={(e) => setRemoteOnly(e.target.checked)}
                    />
                    <span className="text-sm text-foreground">Only show remote roles</span>
                  </label>
                </div>
              </Section>

              <div className="flex items-center gap-4">
                <Button type="submit" size="lg" disabled={saving}>
                  {saving ? 'Saving…' : 'Save changes'}
                </Button>
                {saved && <span className="text-sm font-semibold text-primary">Saved.</span>}
              </div>
            </div>

            <aside className="flex flex-col gap-6">
              <div className="rounded-2xl border border-border bg-card p-6 text-center">
                <div className="mx-auto w-fit">
                  <ScoreRing score={completeness} size={88} strokeWidth={6} />
                </div>
                <h2 className="mt-4 text-base font-semibold text-foreground">Profile completeness</h2>
                <ul className="mt-4 space-y-2 text-left">
                  {checks.map((item) => (
                    <li
                      key={item.key}
                      className={cn(
                        'flex items-center gap-2 text-sm',
                        item.done ? 'text-foreground' : 'text-muted-foreground'
                      )}
                    >
                      <ion-icon
                        name={item.done ? 'checkmark-circle' : 'ellipse-outline'}
                        style={{ color: item.done ? 'var(--primary)' : 'var(--muted-foreground)' }}
                      />
                      {item.label}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-2xl border border-border bg-card p-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold text-foreground">CV status</h2>
                  <span
                    className={cn(
                      'rounded-full px-2.5 py-0.5 text-xs font-medium',
                      hasCv ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                    )}
                  >
                    {hasCv ? 'On file' : 'Not uploaded'}
                  </span>
                </div>
                {hasCv && profile.cvText ? (
                  <p className="mt-3 line-clamp-4 text-sm text-muted-foreground">{profile.cvText.slice(0, 200)}</p>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">
                    Upload a CV so scoring can match you against open roles.
                  </p>
                )}
                <Link
                  to="/cv"
                  className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
                >
                  <ion-icon name="document-text-outline" /> {hasCv ? 'Manage CV' : 'Upload CV'}
                </Link>
                {cvExportError && <p className="mt-2 text-xs text-destructive">{cvExportError}</p>}
                <Button
                  type="button"
                  variant="outline"
                  disabled={generatingCv}
                  onClick={handleGenerateCv}
                  className="mt-4 w-full"
                >
                  {generatingCv ? 'Generating…' : 'Generate CV (PDF)'}
                </Button>
              </div>
            </aside>
          </form>
        )}
      </div>
    </div>
  )
}
