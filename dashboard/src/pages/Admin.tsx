import { useEffect, useState } from 'react'
import type { Profile } from '@job-hunter/shared'
import { apiFetch } from '../api/client'
import { Header } from '../components/Header'
import { Button } from '../components/Button'
import { FormError } from '../components/FormError'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs'

interface DiscoveryStatus {
  totalJobs: number
  mostRecentDiscoveredAt: string | null
}

interface DiscoveryRunResult {
  discovered: number
  duplicates: number
  errors: Array<{ sourceId: string; message: string }>
}

interface UsersResponseBody {
  users: Profile[]
}

function formatDateTime(dateString: string | null): string {
  if (!dateString) return 'never'
  return new Date(dateString).toLocaleString()
}

function JobSyncTab() {
  const [status, setStatus] = useState<DiscoveryStatus | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [runResult, setRunResult] = useState<DiscoveryRunResult | null>(null)
  const [runError, setRunError] = useState<string | null>(null)

  function loadStatus() {
    setStatusError(null)
    apiFetch('/admin/discovery/status')
      .then(async (res) => {
        if (!res.ok) {
          setStatusError('Failed to load sync status.')
          return
        }
        setStatus(await res.json())
      })
      .catch(() => setStatusError('Failed to load sync status.'))
  }

  useEffect(loadStatus, [])

  async function handleRunSync() {
    setRunning(true)
    setRunError(null)
    setRunResult(null)
    try {
      const res = await apiFetch('/discovery/run', { method: 'POST' })
      if (!res.ok) {
        setRunError('Sync run failed.')
        return
      }
      setRunResult(await res.json())
      loadStatus()
    } catch {
      setRunError('Could not reach the server.')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {statusError && <FormError message={statusError} />}
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-slate-500">Total jobs</dt>
            <dd className="mt-1 text-lg font-semibold text-slate-900">{status?.totalJobs ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Most recently discovered</dt>
            <dd className="mt-1 text-lg font-semibold text-slate-900">
              {status ? formatDateTime(status.mostRecentDiscoveredAt) : '—'}
            </dd>
          </div>
        </dl>
        <Button className="mt-6" onClick={handleRunSync} disabled={running}>
          {running ? 'Syncing…' : 'Run sync now'}
        </Button>
      </div>

      {runError && <FormError message={runError} />}
      {runResult && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm">
          <h3 className="font-semibold text-slate-900">Last run result</h3>
          <p className="mt-2 text-slate-600">
            Discovered {runResult.discovered}, skipped {runResult.duplicates} duplicate
            {runResult.duplicates === 1 ? '' : 's'}.
          </p>
          {runResult.errors.length > 0 && (
            <ul className="mt-3 flex flex-col gap-1 text-red-700">
              {runResult.errors.map((err, i) => (
                <li key={i}>
                  {err.sourceId}: {err.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

function UsersTab() {
  const [users, setUsers] = useState<Profile[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    apiFetch('/admin/users')
      .then(async (res) => {
        if (!res.ok) {
          setError('Failed to load users.')
          return
        }
        const data: UsersResponseBody = await res.json()
        setUsers(data.users)
      })
      .catch(() => setError('Failed to load users.'))
  }, [])

  if (error) return <FormError message={error} />
  if (!users) return <p className="text-sm text-slate-500">Loading…</p>

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead>
          <tr className="text-left text-slate-500">
            <th className="px-4 py-3 font-medium">Email</th>
            <th className="px-4 py-3 font-medium">Registered</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {users.map((user) => (
            <tr key={user._id}>
              <td className="px-4 py-3 text-slate-900">{user.email}</td>
              <td className="px-4 py-3 text-slate-600">{formatDateTime(user.createdAt ?? null)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function AdminPage() {
  return (
    <div className="min-h-screen bg-slate-50">
      <Header />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="text-lg font-semibold text-slate-900">Admin panel</h1>
        <Tabs defaultValue="sync" className="mt-6">
          <TabsList>
            <TabsTrigger value="sync">Job sync</TabsTrigger>
            <TabsTrigger value="users">Users</TabsTrigger>
          </TabsList>
          <TabsContent value="sync">
            <JobSyncTab />
          </TabsContent>
          <TabsContent value="users">
            <UsersTab />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  )
}
