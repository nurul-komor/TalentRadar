import { Icon } from '../components/Icon'
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { emptyResume } from '@job-hunter/shared'
import type { Eligibility, Profile, Resume } from '@job-hunter/shared'
import { apiFetch } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { FormError } from '../components/FormError'
import { ScoreRing } from '../components/ScoreRing'
import { profileRequiredChecks, type ProfileCheckKey } from '../lib/profileCompleteness'
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

// Section ids are shared between the on-page anchors (scroll-mt handles the
// offset) and the "jump to section" nav + completeness checklist so clicking a
// checklist row takes the user straight to the fields that still need filling.
const SECTION = {
  personal: 'section-personal',
  links: 'section-links',
  experience: 'section-experience',
  education: 'section-education',
  skills: 'section-skills',
  projects: 'section-projects',
  eligibility: 'section-eligibility',
  preferences: 'section-preferences',
} as const

// Per-check UI metadata keyed off the canonical check set in
// profileCompleteness. `label` is the checklist row text; `target` is where the
// row scrolls (a section id) or links (the CV upload lives on its own page).
const CHECK_META: Record<ProfileCheckKey, { label: string; target: string }> = {
  fullName: { label: 'Full name', target: SECTION.personal },
  phone: { label: 'Phone number', target: SECTION.personal },
  country: { label: 'Country', target: SECTION.personal },
  city: { label: 'City', target: SECTION.personal },
  linkedin: { label: 'LinkedIn profile', target: SECTION.links },
  github: { label: 'Portfolio / GitHub', target: SECTION.links },
  cv: { label: 'CV uploaded', target: '/cv' },
  experience: { label: 'Work experience', target: SECTION.experience },
  education: { label: 'Education', target: SECTION.education },
  skills: { label: 'Skills', target: SECTION.skills },
}

// Decorates the canonical required-field set (the single source of truth shared
// with the Dashboard/sidebar ring) with this page's labels + scroll targets.
// Also used to flip onboardingCompletedAt once every check is satisfied.
function requiredChecks(resume: Resume, cvText: string | null) {
  return profileRequiredChecks(resume, cvText).map((check) => ({
    ...check,
    label: CHECK_META[check.key].label,
    target: CHECK_META[check.key].target,
  }))
}

const SECTION_NAV: Array<{ id: string; label: string; icon: string }> = [
  { id: SECTION.personal, label: 'Personal', icon: 'person-outline' },
  { id: SECTION.links, label: 'Links', icon: 'link-outline' },
  { id: SECTION.experience, label: 'Experience', icon: 'briefcase-outline' },
  { id: SECTION.education, label: 'Education', icon: 'school-outline' },
  { id: SECTION.skills, label: 'Skills', icon: 'build-outline' },
  { id: SECTION.projects, label: 'Projects', icon: 'cube-outline' },
  { id: SECTION.eligibility, label: 'Eligibility', icon: 'shield-checkmark-outline' },
  { id: SECTION.preferences, label: 'Preferences', icon: 'options-outline' },
]

const selectClass =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]'

// Custom event a Section listens for so the completeness checklist can expand a
// collapsed card (on phone, sections are accordions) before scrolling to it.
const OPEN_SECTION_EVENT = 'profile:open-section'

function scrollToSection(id: string) {
  window.dispatchEvent(new CustomEvent(OPEN_SECTION_EVENT, { detail: id }))
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function initialsFor(name: string | null | undefined, email: string): string {
  const source = name?.trim() || email
  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return source.slice(0, 2).toUpperCase()
}

// Section shell with an icon, title, and optional one-line description. `id`
// anchors the "jump to" nav and completeness checklist; `complete` renders a
// subtle status badge so progress is readable while scrolling.
function Section({
  id,
  icon,
  title,
  description,
  complete,
  defaultOpen = false,
  children,
}: {
  id: string
  icon: string
  title: string
  description?: string
  complete?: boolean
  // Collapsed-by-default drives the phone-only accordion; the first section opens
  // on load. On md+ the card is always expanded regardless of this state.
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)

  // Let the completeness checklist expand this card when it jumps here.
  useEffect(() => {
    function handleOpen(event: Event) {
      if ((event as CustomEvent<string>).detail === id) setOpen(true)
    }
    window.addEventListener(OPEN_SECTION_EVENT, handleOpen)
    return () => window.removeEventListener(OPEN_SECTION_EVENT, handleOpen)
  }, [id])

  return (
    <section id={id} className="scroll-mt-6 rounded-2xl border border-border bg-card p-4 md:p-6">
      {/* Header doubles as the accordion toggle on phone; inert (always-open) on md+.
          Phone uses a compact single-line row (description hidden, status reduced to a
          check icon) so the icon/title/status/chevron don't fight for width. */}
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 text-left md:items-start md:gap-4 md:pointer-events-none"
      >
        <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-accent text-accent-foreground md:mt-0.5">
          <Icon name={icon} style={{ fontSize: 18 }} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold leading-tight text-foreground md:whitespace-normal md:text-lg">
            {title}
          </h2>
          {description && <p className="mt-0.5 hidden text-sm text-muted-foreground md:block">{description}</p>}
        </div>
        {complete != null && (
          <span
            className={cn(
              'inline-flex flex-none items-center gap-1 rounded-full p-1.5 text-xs font-medium md:px-2.5 md:py-1',
              complete ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
            )}
          >
            <Icon name={complete ? 'checkmark-circle' : 'ellipse-outline'} style={{ fontSize: 13 }} />
            <span className="hidden md:inline">{complete ? 'Complete' : 'Needs info'}</span>
          </span>
        )}
        <Icon
          name="chevron-down-outline"
          className={cn('flex-none transition-transform md:hidden', open && 'rotate-180')}
          style={{ fontSize: 18 }}
        />
      </button>
      <div className={cn('mt-5', open ? 'block' : 'hidden md:block')}>{children}</div>
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
  // Snapshot of the last-persisted form state; compared against the live form
  // to drive the "unsaved changes" affordance and disable Save when clean.
  const [baseline, setBaseline] = useState<string | null>(null)

  useEffect(() => {
    apiFetch('/profile').then(async (res) => {
      if (!res.ok) {
        setError('Failed to load profile.')
        return
      }
      const data: Profile = await res.json()
      const loadedResume = { ...emptyResume(), ...data.resume }
      setProfile(data)
      setResume(loadedResume)
      setWorkAuthorization(data.eligibility.workAuthorization)
      setCountries(data.eligibility.countries)
      setTargetRoles(data.preferences.targetRoles)
      setLocations(data.preferences.locations)
      setRemoteOnly(data.preferences.remoteOnly)
      setMinSalaryUsd(data.preferences.minSalaryUsd?.toString() ?? '')
      setBaseline(
        JSON.stringify({
          resume: loadedResume,
          workAuthorization: data.eligibility.workAuthorization,
          countries: data.eligibility.countries,
          targetRoles: data.preferences.targetRoles,
          locations: data.preferences.locations,
          remoteOnly: data.preferences.remoteOnly,
          minSalaryUsd: data.preferences.minSalaryUsd?.toString() ?? '',
        })
      )
    })
  }, [])

  const snapshot = useMemo(
    () =>
      JSON.stringify({ resume, workAuthorization, countries, targetRoles, locations, remoteOnly, minSalaryUsd }),
    [resume, workAuthorization, countries, targetRoles, locations, remoteOnly, minSalaryUsd]
  )
  const dirty = baseline != null && snapshot !== baseline

  function patchResume(patch: Partial<Resume>) {
    setResume((prev) => ({ ...prev, ...patch }))
    setSaved(false)
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
      // Re-baseline so the form reads as clean again after a successful save.
      setBaseline(snapshot)
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
  const doneCount = checks.filter((c) => c.done).length
  const completeness = Math.round((doneCount / checks.length) * 100)

  // Per-section completeness for the inline status badges.
  const personalComplete = checks
    .filter((c) => c.target === SECTION.personal)
    .every((c) => c.done)
  const linksComplete = checks.filter((c) => c.target === SECTION.links).every((c) => c.done)

  return (
    <div>
      <header className="border-b border-border bg-card/40">
        <div className="mx-auto flex max-w-5xl flex-col gap-5 px-6 py-10 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 flex-none items-center justify-center rounded-2xl bg-primary/10 text-lg font-semibold text-primary">
              {profile ? initialsFor(resume.fullName, profile.email) : '··'}
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-primary">Account</div>
              <h1 className="mt-1 text-2xl font-bold text-foreground sm:text-3xl">
                {resume.fullName?.trim() || 'Your profile'}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">{profile?.email ?? 'Loading…'}</p>
            </div>
          </div>
          {profile && (
            <div className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3">
              <ScoreRing score={completeness} size={44} strokeWidth={4} />
              <div className="leading-tight">
                <div className="text-sm font-semibold text-foreground">Profile complete</div>
                <div className="text-xs text-muted-foreground">
                  {doneCount} of {checks.length} steps done
                </div>
              </div>
            </div>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-6 pb-24">
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
              <Section
                id={SECTION.personal}
                icon="person-outline"
                title="Personal details"
                description="How you appear to recruiters and on your generated CV."
                complete={personalComplete}
                defaultOpen
              >
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

              <Section
                id={SECTION.links}
                icon="link-outline"
                title="Professional links"
                description="Where recruiters can see more of your work."
                complete={linksComplete}
              >
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

              <Section
                id={SECTION.experience}
                icon="briefcase-outline"
                title="Work experience"
                description="List roles with your most recent first."
                complete={resume.experience.length > 0}
              >
                <RepeatableSection
                  addLabel="Add experience"
                  count={resume.experience.length}
                  emptyIcon="briefcase-outline"
                  emptyHint="Add the roles you've held so we can match you against open jobs."
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

              <Section
                id={SECTION.education}
                icon="school-outline"
                title="Education"
                description="Degrees, bootcamps, and credentials."
                complete={resume.education.length > 0}
              >
                <RepeatableSection
                  addLabel="Add education"
                  count={resume.education.length}
                  emptyIcon="school-outline"
                  emptyHint="Add your degrees or certifications."
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

              <Section
                id={SECTION.skills}
                icon="build-outline"
                title="Skills"
                description="Group related skills by category."
                complete={resume.skillGroups.some((g) => g.skills.length > 0)}
              >
                <RepeatableSection
                  addLabel="Add skill group"
                  count={resume.skillGroups.length}
                  emptyIcon="build-outline"
                  emptyHint="Group your skills (e.g. Languages, Frameworks) to strengthen matches."
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

              <Section
                id={SECTION.projects}
                icon="cube-outline"
                title="Projects"
                description="Side projects and notable work (optional)."
              >
                <RepeatableSection
                  addLabel="Add project"
                  count={resume.projects.length}
                  emptyIcon="cube-outline"
                  emptyHint="Showcase side projects or open-source work."
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

              <Section
                id={SECTION.eligibility}
                icon="shield-checkmark-outline"
                title="Eligibility"
                description="Helps us filter roles you can actually take."
              >
                <div className="grid grid-cols-1 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="pf-workAuth">Work authorization</Label>
                    <select
                      id="pf-workAuth"
                      className={selectClass}
                      value={workAuthorization}
                      onChange={(e) => {
                        setWorkAuthorization(e.target.value as WorkAuthorization)
                        setSaved(false)
                      }}
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
                      onAdd={(value) => {
                        setCountries((prev) => [...prev, value])
                        setSaved(false)
                      }}
                      onRemove={(index) => {
                        setCountries((prev) => prev.filter((_, i) => i !== index))
                        setSaved(false)
                      }}
                    />
                  </div>
                </div>
              </Section>

              <Section
                id={SECTION.preferences}
                icon="options-outline"
                title="Job preferences"
                description="Shapes which roles we surface for you."
              >
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5 sm:col-span-2">
                    <Label>Target roles</Label>
                    <TagList
                      items={targetRoles}
                      placeholder="Add a role"
                      onAdd={(value) => {
                        setTargetRoles((prev) => [...prev, value])
                        setSaved(false)
                      }}
                      onRemove={(index) => {
                        setTargetRoles((prev) => prev.filter((_, i) => i !== index))
                        setSaved(false)
                      }}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5 sm:col-span-2">
                    <Label>Preferred locations</Label>
                    <TagList
                      items={locations}
                      placeholder="Add a location"
                      onAdd={(value) => {
                        setLocations((prev) => [...prev, value])
                        setSaved(false)
                      }}
                      onRemove={(index) => {
                        setLocations((prev) => prev.filter((_, i) => i !== index))
                        setSaved(false)
                      }}
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
                      onChange={(e) => {
                        setMinSalaryUsd(e.target.value)
                        setSaved(false)
                      }}
                    />
                  </div>
                  <label className="flex items-center gap-2.5 sm:mt-7">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={remoteOnly}
                      onChange={(e) => {
                        setRemoteOnly(e.target.checked)
                        setSaved(false)
                      }}
                    />
                    <span className="text-sm text-foreground">Only show remote roles</span>
                  </label>
                </div>
              </Section>

              {/* Sticky save bar — stays reachable through the long form and
                  surfaces unsaved-change state without a scroll to the bottom. */}
              <div className="sticky bottom-4 z-10 flex items-center justify-between gap-4 rounded-2xl border border-border bg-card/90 px-5 py-3 shadow-lg backdrop-blur">
                <div className="flex items-center gap-2 text-sm">
                  {dirty ? (
                    <>
                      <span className="h-2 w-2 flex-none rounded-full bg-amber-500" />
                      <span className="text-muted-foreground">Unsaved changes</span>
                    </>
                  ) : saved ? (
                    <>
                      <Icon name="checkmark-circle" style={{ color: 'var(--primary)', fontSize: 16 }} />
                      <span className="font-medium text-primary">All changes saved</span>
                    </>
                  ) : (
                    <>
                      <Icon name="checkmark-circle-outline" style={{ color: 'var(--muted-foreground)', fontSize: 16 }} />
                      <span className="text-muted-foreground">Up to date</span>
                    </>
                  )}
                </div>
                <Button type="submit" size="lg" disabled={saving || !dirty}>
                  {saving ? 'Saving…' : 'Save changes'}
                </Button>
              </div>
            </div>

            <aside className="flex flex-col gap-6 lg:sticky lg:top-6 lg:self-start">
              <div className="rounded-2xl border border-border bg-card p-6">
                <div className="flex items-center gap-4">
                  <ScoreRing score={completeness} size={72} strokeWidth={6} />
                  <div>
                    <h2 className="text-base font-semibold text-foreground">Profile completeness</h2>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {doneCount} of {checks.length} required steps
                    </p>
                  </div>
                </div>
                <ul className="mt-5 space-y-1">
                  {checks.map((item) => {
                    const row = (
                      <>
                        <Icon
                          name={item.done ? 'checkmark-circle' : 'ellipse-outline'}
                          style={{ color: item.done ? 'var(--primary)' : 'var(--muted-foreground)', fontSize: 16 }}
                        />
                        <span className="flex-1 text-left">{item.label}</span>
                        {!item.done && (
                          <Icon
                            name="chevron-forward-outline"
                            style={{ color: 'var(--muted-foreground)', fontSize: 13 }}
                          />
                        )}
                      </>
                    )
                    const base = cn(
                      'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors',
                      item.done ? 'text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    )
                    return (
                      <li key={item.key}>
                        {item.target === '/cv' ? (
                          <Link to="/cv" className={base}>
                            {row}
                          </Link>
                        ) : (
                          <button type="button" onClick={() => scrollToSection(item.target)} className={base}>
                            {row}
                          </button>
                        )}
                      </li>
                    )
                  })}
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
                  <Icon name="document-text-outline" /> {hasCv ? 'Manage CV' : 'Upload CV'}
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

              <nav className="hidden rounded-2xl border border-border bg-card p-4 lg:block">
                <div className="px-2 pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Jump to
                </div>
                <ul className="space-y-0.5">
                  {SECTION_NAV.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => scrollToSection(item.id)}
                        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      >
                        <Icon name={item.icon} style={{ fontSize: 15 }} />
                        {item.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </nav>
            </aside>
          </form>
        )}
      </div>
    </div>
  )
}
