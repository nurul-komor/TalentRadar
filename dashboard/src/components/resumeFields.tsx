import { useState, type KeyboardEvent, type ReactNode } from 'react'
import type {
  Resume,
  ResumeEducation,
  ResumeExperience,
  ResumeProject,
  ResumeSkillGroup,
} from '@job-hunter/shared'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

interface TagListProps {
  items: string[]
  placeholder: string
  onAdd: (value: string) => void
  onRemove: (index: number) => void
}

export function TagList({ items, placeholder, onAdd, onRemove }: TagListProps) {
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
    <div className="flex flex-wrap items-center gap-2">
      {items.map((item, index) => (
        <span
          key={`${item}-${index}`}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium text-foreground"
        >
          {item}
          <button
            type="button"
            aria-label={`Remove ${item}`}
            onClick={() => onRemove(index)}
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            <ion-icon name="close-outline" style={{ fontSize: 12 }} />
          </button>
        </span>
      ))}
      {adding ? (
        <input
          autoFocus
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={commit}
          className="min-w-32 rounded-full border border-dashed border-border bg-transparent px-3 py-1 text-xs text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring"
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-ring hover:text-foreground"
        >
          <ion-icon name="add-outline" style={{ fontSize: 12 }} /> Add
        </button>
      )}
    </div>
  )
}

// Generic immutable helpers for the repeatable resume lists (experience,
// projects, skillGroups, education) — keeps add/update/remove wiring for
// each entity down to a one-liner instead of duplicating splice logic.
export function appendEntry<T>(list: T[], entry: T): T[] {
  return [...list, entry]
}

export function updateEntryAt<T>(list: T[], index: number, patch: Partial<T>): T[] {
  return list.map((item, i) => (i === index ? { ...item, ...patch } : item))
}

export function removeEntryAt<T>(list: T[], index: number): T[] {
  return list.filter((_, i) => i !== index)
}

export function nullIfBlank(value: string | null): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed === '' ? null : trimmed
}

function sanitizeBullets(bullets: string[]): string[] {
  return bullets.map((bullet) => bullet.trim()).filter((bullet) => bullet !== '')
}

// Builds a clean Resume from in-progress UI state: trims free-text fields,
// drops blank bullet lines, and converts empty strings to null so the
// shape matches ResumeSchema (e.g. an empty endDate means "Present").
export function sanitizeResumeForSave(resume: Resume): Resume {
  return {
    ...resume,
    fullName: nullIfBlank(resume.fullName),
    headline: nullIfBlank(resume.headline),
    phone: nullIfBlank(resume.phone),
    linkedin: nullIfBlank(resume.linkedin),
    github: nullIfBlank(resume.github),
    summary: nullIfBlank(resume.summary),
    location: {
      country: nullIfBlank(resume.location.country),
      city: nullIfBlank(resume.location.city),
    },
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

// Labeled text field used across the resume entry cards. `full` spans both
// grid columns on wider viewports.
interface FieldProps {
  id: string
  label: string
  value: string
  placeholder?: string
  full?: boolean
  onChange: (value: string) => void
}

export function Field({ id, label, value, placeholder, full, onChange }: FieldProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', full && 'sm:col-span-2')}>
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}

interface EntryCardProps {
  label: string
  onRemove: () => void
  children: ReactNode
}

export function EntryCard({ label, onRemove, children }: EntryCardProps) {
  return (
    <div className="mb-3 rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-semibold text-foreground">{label}</span>
        <button
          type="button"
          aria-label={`Remove ${label}`}
          onClick={onRemove}
          className="text-muted-foreground transition-colors hover:text-destructive"
        >
          <ion-icon name="close-outline" style={{ fontSize: 14 }} />
        </button>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
    </div>
  )
}

interface BulletsFieldProps {
  bullets: string[]
  onChange: (bullets: string[]) => void
}

export function BulletsField({ bullets, onChange }: BulletsFieldProps) {
  return (
    <div className="flex flex-col gap-1.5 sm:col-span-2">
      <Label>Bullets (one per line)</Label>
      <Textarea
        value={bullets.join('\n')}
        placeholder={'Shipped feature X that improved Y by 20%\nLed migration of Z to ...'}
        onChange={(e) => onChange(e.target.value.split('\n'))}
        className="min-h-24"
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

export function ExperienceEntryFields({ entry, index, onChange, onRemove }: ExperienceEntryFieldsProps) {
  return (
    <EntryCard label={`Experience ${index + 1}`} onRemove={() => onRemove(index)}>
      <Field
        id={`exp-company-${index}`}
        label="Company"
        value={entry.company}
        placeholder="Acme Corp"
        onChange={(v) => onChange(index, { company: v })}
      />
      <Field
        id={`exp-role-${index}`}
        label="Role"
        value={entry.role}
        placeholder="Senior Software Engineer"
        onChange={(v) => onChange(index, { role: v })}
      />
      <Field
        id={`exp-start-${index}`}
        label="Start date"
        value={entry.startDate}
        placeholder="Jan 2022"
        onChange={(v) => onChange(index, { startDate: v })}
      />
      <Field
        id={`exp-end-${index}`}
        label="End date"
        value={entry.endDate ?? ''}
        placeholder="Present"
        onChange={(v) => onChange(index, { endDate: v })}
      />
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

export function ProjectEntryFields({ entry, index, onChange, onRemove }: ProjectEntryFieldsProps) {
  return (
    <EntryCard label={`Project ${index + 1}`} onRemove={() => onRemove(index)}>
      <Field
        id={`proj-name-${index}`}
        label="Name"
        value={entry.name}
        placeholder="Job Hunter"
        onChange={(v) => onChange(index, { name: v })}
      />
      <Field
        id={`proj-role-${index}`}
        label="Role"
        value={entry.role}
        placeholder="Creator"
        onChange={(v) => onChange(index, { role: v })}
      />
      <Field
        id={`proj-url-${index}`}
        label="URL"
        value={entry.url ?? ''}
        placeholder="github.com/you/project"
        full
        onChange={(v) => onChange(index, { url: v })}
      />
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <Label>Technologies</Label>
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

export function SkillGroupEntryFields({ entry, index, onChange, onRemove }: SkillGroupEntryFieldsProps) {
  return (
    <EntryCard label={`Skill group ${index + 1}`} onRemove={() => onRemove(index)}>
      <Field
        id={`skillgroup-category-${index}`}
        label="Category"
        value={entry.category}
        placeholder="Languages"
        full
        onChange={(v) => onChange(index, { category: v })}
      />
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <Label>Skills</Label>
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

export function EducationEntryFields({ entry, index, onChange, onRemove }: EducationEntryFieldsProps) {
  return (
    <EntryCard label={`Education ${index + 1}`} onRemove={() => onRemove(index)}>
      <Field
        id={`edu-institution-${index}`}
        label="Institution"
        value={entry.institution}
        placeholder="State University"
        onChange={(v) => onChange(index, { institution: v })}
      />
      <Field
        id={`edu-credential-${index}`}
        label="Credential"
        value={entry.credential}
        placeholder="B.Sc. Computer Science"
        onChange={(v) => onChange(index, { credential: v })}
      />
    </EntryCard>
  )
}

// Repeatable-list section header with an "add" affordance, shared by the
// experience / education / skills steps.
interface RepeatableSectionProps {
  addLabel: string
  onAdd: () => void
  children: ReactNode
}

export function RepeatableSection({ addLabel, onAdd, children }: RepeatableSectionProps) {
  return (
    <div>
      {children}
      <Button type="button" variant="ghost" className="mt-2" onClick={onAdd}>
        <ion-icon name="add-outline" /> {addLabel}
      </Button>
    </div>
  )
}
