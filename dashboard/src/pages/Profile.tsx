import {
  useEffect,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { Link } from 'react-router-dom'
import { emptyResume } from '@job-hunter/shared'
import type {
  Eligibility,
  Profile,
  Resume,
  ResumeEducation,
  ResumeExperience,
  ResumeProject,
  ResumeSkillGroup,
} from '@job-hunter/shared'
import { apiFetch } from '../api/client'
import { Button } from '../components/Button'
import { FormError } from '../components/FormError'
import { ScoreRing } from '../components/ScoreRing'
import { Pill } from '../components/Pill'

type WorkAuthorization = Eligibility['workAuthorization']

const WORK_AUTH_OPTIONS: Array<{ value: WorkAuthorization; label: string }> = [
  { value: 'unknown', label: 'Not specified' },
  { value: 'citizen', label: 'Citizen' },
  { value: 'permanent_resident', label: 'Permanent resident' },
  { value: 'visa_required', label: 'Visa required' },
]

const selectInputStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  fontFamily: 'var(--font-body)',
  fontSize: 15,
  color: 'var(--fg)',
  padding: '13px 0',
}

const tagDraftInputStyle: CSSProperties = {
  border: '1px dashed var(--line-strong)',
  borderRadius: 999,
  padding: '6px 12px',
  fontSize: 13,
  background: 'transparent',
  color: 'var(--fg)',
  outline: 'none',
  minWidth: 120,
  fontFamily: 'var(--font-body)',
}

interface TagListProps {
  items: string[]
  placeholder: string
  onAdd: (value: string) => void
  onRemove: (index: number) => void
}

function TagList({ items, placeholder, onAdd, onRemove }: TagListProps) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')

  function commit() {
    const value = draft.trim()
    if (value && !items.includes(value)) onAdd(value)
    setDraft('')
    setAdding(false)
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      commit()
    } else if (e.key === 'Escape') {
      setDraft('')
      setAdding(false)
    }
  }

  return (
    <div className="taglist">
      {items.map((item, index) => (
        <span className="pill" key={`${item}-${index}`}>
          {item}
          <button type="button" aria-label={`Remove ${item}`} onClick={() => onRemove(index)}>
            <ion-icon name="close-outline" style={{ fontSize: 12 }} />
          </button>
        </span>
      ))}
      {adding ? (
        <input
          autoFocus
          style={tagDraftInputStyle}
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={commit}
        />
      ) : (
        <button type="button" className="pill add" onClick={() => setAdding(true)}>
          <ion-icon name="add-outline" style={{ fontSize: 12 }} /> Add
        </button>
      )}
    </div>
  )
}

// Generic immutable helpers for the repeatable resume lists (experience,
// projects, skillGroups, education) — keeps add/update/remove wiring for
// each entity down to a one-liner instead of duplicating splice logic.
function appendEntry<T>(list: T[], entry: T): T[] {
  return [...list, entry]
}

function updateEntryAt<T>(list: T[], index: number, patch: Partial<T>): T[] {
  return list.map((item, i) => (i === index ? { ...item, ...patch } : item))
}

function removeEntryAt<T>(list: T[], index: number): T[] {
  return list.filter((_, i) => i !== index)
}

function nullIfBlank(value: string | null): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed === '' ? null : trimmed
}

function sanitizeBullets(bullets: string[]): string[] {
  return bullets.map((bullet) => bullet.trim()).filter((bullet) => bullet !== '')
}

// Builds the PUT payload from in-progress UI state: trims free-text fields,
// drops blank bullet lines, and converts empty strings to null so the
// shape matches ResumeSchema (e.g. an empty endDate means "Present").
function sanitizeResumeForSave(resume: Resume): Resume {
  return {
    ...resume,
    fullName: nullIfBlank(resume.fullName),
    headline: nullIfBlank(resume.headline),
    phone: nullIfBlank(resume.phone),
    summary: nullIfBlank(resume.summary),
    experience: resume.experience.map((entry) => ({
      ...entry,
      endDate: nullIfBlank(entry.endDate),
      bullets: sanitizeBullets(entry.bullets),
    })),
    projects: resume.projects.map((entry) => ({
      ...entry,
      url: nullIfBlank(entry.url),
      bullets: sanitizeBullets(entry.bullets),
    })),
  }
}

interface EntryCardProps {
  label: string
  onRemove: () => void
  children: ReactNode
}

function EntryCard({ label, onRemove, children }: EntryCardProps) {
  return (
    <div className="entry-card">
      <div className="entry-head">
        <span>{label}</span>
        <button type="button" className="entry-remove" aria-label={`Remove ${label}`} onClick={onRemove}>
          <ion-icon name="close-outline" style={{ fontSize: 14 }} />
        </button>
      </div>
      <div className="fgrid">{children}</div>
    </div>
  )
}

interface BulletsFieldProps {
  bullets: string[]
  onChange: (bullets: string[]) => void
}

function BulletsField({ bullets, onChange }: BulletsFieldProps) {
  return (
    <div className="field full">
      <label>Bullets (one per line)</label>
      <textarea
        value={bullets.join('\n')}
        placeholder={'Shipped feature X that improved Y by 20%\nLed migration of Z to ...'}
        onChange={(e) => onChange(e.target.value.split('\n'))}
      />
    </div>
  )
}

interface ExperienceEntryFieldsProps {
  entry: ResumeExperience
  index: number
  onChange: (index: number, patch: Partial<ResumeExperience>) => void
  onRemove: (index: number) => void
}

function ExperienceEntryFields({ entry, index, onChange, onRemove }: ExperienceEntryFieldsProps) {
  return (
    <EntryCard label={`Experience ${index + 1}`} onRemove={() => onRemove(index)}>
      <div className="field">
        <label htmlFor={`exp-company-${index}`}>Company</label>
        <div className="in">
          <input
            id={`exp-company-${index}`}
            value={entry.company}
            placeholder="Acme Corp"
            onChange={(e) => onChange(index, { company: e.target.value })}
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor={`exp-role-${index}`}>Role</label>
        <div className="in">
          <input
            id={`exp-role-${index}`}
            value={entry.role}
            placeholder="Senior Software Engineer"
            onChange={(e) => onChange(index, { role: e.target.value })}
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor={`exp-start-${index}`}>Start date</label>
        <div className="in">
          <input
            id={`exp-start-${index}`}
            value={entry.startDate}
            placeholder="Jan 2022"
            onChange={(e) => onChange(index, { startDate: e.target.value })}
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor={`exp-end-${index}`}>End date</label>
        <div className="in">
          <input
            id={`exp-end-${index}`}
            value={entry.endDate ?? ''}
            placeholder="Present"
            onChange={(e) => onChange(index, { endDate: e.target.value })}
          />
        </div>
      </div>
      <BulletsField bullets={entry.bullets} onChange={(bullets) => onChange(index, { bullets })} />
    </EntryCard>
  )
}

interface ProjectEntryFieldsProps {
  entry: ResumeProject
  index: number
  onChange: (index: number, patch: Partial<ResumeProject>) => void
  onRemove: (index: number) => void
}

function ProjectEntryFields({ entry, index, onChange, onRemove }: ProjectEntryFieldsProps) {
  return (
    <EntryCard label={`Project ${index + 1}`} onRemove={() => onRemove(index)}>
      <div className="field">
        <label htmlFor={`proj-name-${index}`}>Name</label>
        <div className="in">
          <input
            id={`proj-name-${index}`}
            value={entry.name}
            placeholder="Job Hunter"
            onChange={(e) => onChange(index, { name: e.target.value })}
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor={`proj-role-${index}`}>Role</label>
        <div className="in">
          <input
            id={`proj-role-${index}`}
            value={entry.role}
            placeholder="Creator"
            onChange={(e) => onChange(index, { role: e.target.value })}
          />
        </div>
      </div>
      <div className="field full">
        <label htmlFor={`proj-url-${index}`}>URL</label>
        <div className="in">
          <input
            id={`proj-url-${index}`}
            value={entry.url ?? ''}
            placeholder="github.com/you/project"
            onChange={(e) => onChange(index, { url: e.target.value })}
          />
        </div>
      </div>
      <div className="field full">
        <label>Technologies</label>
        <TagList
          items={entry.technologies}
          placeholder="Add a technology"
          onAdd={(value) => onChange(index, { technologies: appendEntry(entry.technologies, value) })}
          onRemove={(i) => onChange(index, { technologies: removeEntryAt(entry.technologies, i) })}
        />
      </div>
      <BulletsField bullets={entry.bullets} onChange={(bullets) => onChange(index, { bullets })} />
    </EntryCard>
  )
}

interface SkillGroupEntryFieldsProps {
  entry: ResumeSkillGroup
  index: number
  onChange: (index: number, patch: Partial<ResumeSkillGroup>) => void
  onRemove: (index: number) => void
}

function SkillGroupEntryFields({ entry, index, onChange, onRemove }: SkillGroupEntryFieldsProps) {
  return (
    <EntryCard label={`Skill group ${index + 1}`} onRemove={() => onRemove(index)}>
      <div className="field full">
        <label htmlFor={`skillgroup-category-${index}`}>Category</label>
        <div className="in">
          <input
            id={`skillgroup-category-${index}`}
            value={entry.category}
            placeholder="Languages"
            onChange={(e) => onChange(index, { category: e.target.value })}
          />
        </div>
      </div>
      <div className="field full">
        <label>Skills</label>
        <TagList
          items={entry.skills}
          placeholder="Add a skill"
          onAdd={(value) => onChange(index, { skills: appendEntry(entry.skills, value) })}
          onRemove={(i) => onChange(index, { skills: removeEntryAt(entry.skills, i) })}
        />
      </div>
    </EntryCard>
  )
}

interface EducationEntryFieldsProps {
  entry: ResumeEducation
  index: number
  onChange: (index: number, patch: Partial<ResumeEducation>) => void
  onRemove: (index: number) => void
}

function EducationEntryFields({ entry, index, onChange, onRemove }: EducationEntryFieldsProps) {
  return (
    <EntryCard label={`Education ${index + 1}`} onRemove={() => onRemove(index)}>
      <div className="field">
        <label htmlFor={`edu-institution-${index}`}>Institution</label>
        <div className="in">
          <input
            id={`edu-institution-${index}`}
            value={entry.institution}
            placeholder="State University"
            onChange={(e) => onChange(index, { institution: e.target.value })}
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor={`edu-credential-${index}`}>Credential</label>
        <div className="in">
          <input
            id={`edu-credential-${index}`}
            value={entry.credential}
            placeholder="B.Sc. Computer Science"
            onChange={(e) => onChange(index, { credential: e.target.value })}
          />
        </div>
      </div>
    </EntryCard>
  )
}

interface ChecklistItem {
  key: string
  label: string
  done: boolean
  // Anchors (e.g. "#field-countries") jump to the field on this page;
  // routes (e.g. "/cv") navigate elsewhere — CV has no inline input here.
  action?: { href: string; label: string }
}

export function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null)
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
      setWorkAuthorization(data.eligibility.workAuthorization)
      setCountries(data.eligibility.countries)
      setTargetRoles(data.preferences.targetRoles)
      setLocations(data.preferences.locations)
      setRemoteOnly(data.preferences.remoteOnly)
      setMinSalaryUsd(data.preferences.minSalaryUsd?.toString() ?? '')
    })
  }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSaved(false)
    setSaving(true)
    try {
      const res = await apiFetch('/profile', {
        method: 'PUT',
        body: JSON.stringify({
          eligibility: {
            workAuthorization,
            countries,
          },
          preferences: {
            targetRoles,
            locations,
            remoteOnly,
            minSalaryUsd: minSalaryUsd ? Number(minSalaryUsd) : null,
          },
        }),
      })
      if (!res.ok) {
        setError('Failed to save profile.')
        return
      }
      setProfile(await res.json())
      setSaved(true)
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

  const checklistItems: ChecklistItem[] = [
    {
      key: 'workAuth',
      label: 'Work authorization set',
      done: workAuthorization !== 'unknown',
      action: { href: '#field-work-authorization', label: 'Set →' },
    },
    {
      key: 'countries',
      label: 'At least one eligible country',
      done: countries.length > 0,
      action: { href: '#field-countries', label: 'Add →' },
    },
    {
      key: 'targetRoles',
      label: 'At least one target role',
      done: targetRoles.length > 0,
      action: { href: '#field-target-roles', label: 'Add →' },
    },
    {
      key: 'locations',
      label: 'At least one preferred location',
      done: locations.length > 0,
      action: { href: '#field-locations', label: 'Add →' },
    },
    {
      key: 'minSalary',
      label: 'Minimum salary set',
      done: minSalaryUsd.trim() !== '',
      action: { href: '#field-min-salary', label: 'Set →' },
    },
    {
      key: 'cv',
      label: 'CV uploaded',
      done: hasCv,
      action: { href: '/cv', label: 'Upload →' },
    },
  ]
  const completeness = Math.round(
    (checklistItems.filter((item) => item.done).length / checklistItems.length) * 100,
  )

  return (
    <>
      <header className="page-head">
        <div className="wrap">
          <div className="kicker">Account</div>
          <h1>Profile</h1>
          <p>{profile?.email ?? 'Loading…'}</p>
        </div>
      </header>

      <div className="wrap" style={{ paddingBottom: 56 }}>
        {error && <FormError message={error} />}

        {!profile ? (
          <p style={{ marginTop: 24, color: 'var(--muted-text)' }}>Loading…</p>
        ) : (
          <form onSubmit={handleSubmit} className="profile">
            <div>
              <section className="psec">
                <h2>Eligibility</h2>
                <div className="fgrid">
                  <div className="field full" id="field-work-authorization">
                    <label htmlFor="workAuthorization">Work authorization</label>
                    <div className="in">
                      <select
                        id="workAuthorization"
                        style={selectInputStyle}
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
                  </div>
                  <div className="field full" id="field-countries">
                    <label>Eligible countries</label>
                    <TagList
                      items={countries}
                      placeholder="Add a country"
                      onAdd={(value) => setCountries((prev) => [...prev, value])}
                      onRemove={(index) => setCountries((prev) => prev.filter((_, i) => i !== index))}
                    />
                  </div>
                </div>
              </section>

              <section className="psec">
                <h2>Job preferences</h2>
                <div className="fgrid">
                  <div className="field full" id="field-target-roles">
                    <label>Target roles</label>
                    <TagList
                      items={targetRoles}
                      placeholder="Add a role"
                      onAdd={(value) => setTargetRoles((prev) => [...prev, value])}
                      onRemove={(index) => setTargetRoles((prev) => prev.filter((_, i) => i !== index))}
                    />
                  </div>
                  <div className="field full" id="field-locations">
                    <label>Preferred locations</label>
                    <TagList
                      items={locations}
                      placeholder="Add a location"
                      onAdd={(value) => setLocations((prev) => [...prev, value])}
                      onRemove={(index) => setLocations((prev) => prev.filter((_, i) => i !== index))}
                    />
                  </div>
                  <div className="field" id="field-min-salary">
                    <label htmlFor="minSalaryUsd">Minimum salary (USD)</label>
                    <div className="in">
                      <input
                        id="minSalaryUsd"
                        type="number"
                        min={0}
                        value={minSalaryUsd}
                        placeholder="e.g. 80000"
                        onChange={(e) => setMinSalaryUsd(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="field">
                    <label htmlFor="remoteOnly">Remote only</label>
                    <div className="in" style={{ gap: 10 }}>
                      <input
                        id="remoteOnly"
                        type="checkbox"
                        style={{ width: 16, height: 16, flex: 'none' }}
                        checked={remoteOnly}
                        onChange={(e) => setRemoteOnly(e.target.checked)}
                      />
                      <span style={{ fontSize: 14, color: 'var(--fg-2)' }}>Only show remote roles</span>
                    </div>
                  </div>
                </div>
              </section>

              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <Button type="submit" variant="indigo" size="lg" disabled={saving}>
                  {saving ? 'Saving…' : 'Save changes'}
                </Button>
                {saved && <span style={{ fontSize: 14, color: 'var(--cyan-text)', fontWeight: 600 }}>Saved.</span>}
              </div>
            </div>

            <aside className="pside">
              <div className="psec complete">
                <div className="big-ring">
                  <ScoreRing score={completeness} size={88} strokeWidth={6} />
                </div>
                <h2 style={{ justifyContent: 'center', marginTop: 16 }}>Profile completeness</h2>
                <ul className="checklist">
                  {checklistItems.map((item) => (
                    <li key={item.key} className={item.done ? 'done' : 'todo'}>
                      {item.done ? (
                        <ion-icon name="checkmark-circle-outline" />
                      ) : (
                        <ion-icon name="ellipse-outline" />
                      )}
                      {item.label}
                      {!item.done &&
                        item.action &&
                        (item.action.href.startsWith('#') ? (
                          <a href={item.action.href}>{item.action.label}</a>
                        ) : (
                          <Link to={item.action.href}>{item.action.label}</Link>
                        ))}
                    </li>
                  ))}
                </ul>
              </div>

              <section className="psec">
                <h2>
                  CV status
                  {hasCv ? <Pill tone="verified">On file</Pill> : <Pill>Not uploaded</Pill>}
                </h2>
                {hasCv && profile.cvText ? (
                  <p className="cv-preview">
                    {profile.cvText.slice(0, 200)}
                    {profile.cvText.length > 200 ? '…' : ''}
                  </p>
                ) : (
                  <p style={{ marginTop: 14, fontSize: 13.5, color: 'var(--muted-text)' }}>
                    Upload a CV so scoring can match you against open roles.
                  </p>
                )}
                <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <ion-icon name="document-text-outline" style={{ fontSize: 14, color: 'var(--muted-text)' }} />
                  <Link to="/cv" style={{ fontSize: 13, fontWeight: 600, color: 'var(--indigo)' }}>
                    {hasCv ? 'Manage CV →' : 'Upload CV →'}
                  </Link>
                </div>
                {cvExportError && (
                  <p style={{ marginTop: 10, fontSize: 12.5, color: '#E5484D' }}>{cvExportError}</p>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  disabled={generatingCv}
                  onClick={handleGenerateCv}
                  style={{ marginTop: 14, width: '100%' }}
                >
                  {generatingCv ? 'Generating…' : 'Generate CV (PDF)'}
                </Button>
              </section>
            </aside>
          </form>
        )}
      </div>
    </>
  )
}
