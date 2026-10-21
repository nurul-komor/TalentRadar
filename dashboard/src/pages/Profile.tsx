import { useEffect, useState, type FormEvent } from 'react'
import type { Profile } from '@job-hunter/shared'
import { apiFetch } from '../api/client'
import { Header } from '../components/Header'
import { TextField } from '../components/TextField'
import { Checkbox } from '../components/Checkbox'
import { Button } from '../components/Button'
import { FormError } from '../components/FormError'

export function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [targetRoles, setTargetRoles] = useState('')
  const [locations, setLocations] = useState('')
  const [remoteOnly, setRemoteOnly] = useState(true)
  const [minSalaryUsd, setMinSalaryUsd] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    apiFetch('/profile').then(async (res) => {
      if (!res.ok) {
        setError('Failed to load profile.')
        return
      }
      const data: Profile = await res.json()
      setProfile(data)
      setTargetRoles(data.preferences.targetRoles.join(', '))
      setLocations(data.preferences.locations.join(', '))
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
          preferences: {
            targetRoles: targetRoles.split(',').map((s) => s.trim()).filter(Boolean),
            locations: locations.split(',').map((s) => s.trim()).filter(Boolean),
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

  return (
    <div className="min-h-screen bg-slate-50">
      <Header />
      <main className="mx-auto max-w-3xl px-4 py-8">
        {error && (
          <div className="mb-4">
            <FormError message={error} />
          </div>
        )}
        {!profile ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
            <h1 className="text-lg font-semibold text-slate-900">Profile</h1>
            <p className="mt-1 text-sm text-slate-500">{profile.email}</p>

            <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-5">
              <TextField
                label="Target roles (comma-separated)"
                name="targetRoles"
                value={targetRoles}
                onChange={(e) => setTargetRoles(e.target.value)}
                placeholder="Software Engineer, Backend Engineer"
              />
              <TextField
                label="Locations (comma-separated)"
                name="locations"
                value={locations}
                onChange={(e) => setLocations(e.target.value)}
                placeholder="Remote, Dhaka"
              />
              <Checkbox
                label="Remote only"
                name="remoteOnly"
                checked={remoteOnly}
                onChange={(e) => setRemoteOnly(e.target.checked)}
              />
              <TextField
                label="Minimum salary (USD)"
                name="minSalaryUsd"
                type="number"
                min={0}
                value={minSalaryUsd}
                onChange={(e) => setMinSalaryUsd(e.target.value)}
              />
              <div className="flex items-center gap-3">
                <Button type="submit" disabled={saving}>
                  {saving ? 'Saving…' : 'Save'}
                </Button>
                {saved && <span className="text-sm text-green-600">Saved.</span>}
              </div>
            </form>
          </div>
        )}
      </main>
    </div>
  )
}
