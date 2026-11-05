import { useCallback, useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import type { Job } from '@job-hunter/shared'
import { apiFetch } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { canSync } from '../lib/syncAccess'
import { FormError } from '../components/FormError'

interface JobsResponseBody {
  jobs: Job[]
  total: number
}

interface DiscoveryRunResult {
  discovered: number
  duplicates: number
  errors: Array<{ sourceId: string; message: string }>
}

interface LastSync {
  at: string
  discovered: number
  duplicates: number
  errorCount: number
}

const LAST_SYNC_KEY = 'job-hunter-last-sync'

function readLastSync(): LastSync | null {
  try {
    const raw = localStorage.getItem(LAST_SYNC_KEY)
    return raw ? (JSON.parse(raw) as LastSync) : null
  } catch {
    return null
  }
}

function formatDateTime(dateString: string | null): string {
  if (!dateString) return 'Never'
  return new Date(dateString).toLocaleString()
}

export function SyncPage() {
  const { email, profileLoading } = useAuth()

  const [stats, setStats] = useState<{ totalJobs: number; mostRecentDiscoveredAt: string | null } | null>(null)
  const [statsError, setStatsError] = useState<string | null>(null)

  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)
  const [runResult, setRunResult] = useState<DiscoveryRunResult | null>(null)
  const [lastSync, setLastSync] = useState<LastSync | null>(() => readLastSync())

  const loadStats = useCallback(() => {
    setStatsError(null)
    apiFetch('/jobs?limit=1')
      .then(async (res) => {
        if (!res.ok) {
          setStatsError('Failed to load sync status.')
          return
        }
        const data: JobsResponseBody = await res.json()
        setStats({
          totalJobs: data.total,
          mostRecentDiscoveredAt: data.jobs[0]?.discoveredAt ?? null,
        })
      })
      .catch(() => setStatsError('Failed to load sync status.'))
  }, [])

  useEffect(() => {
    if (canSync(email)) loadStats()
  }, [email, loadStats])

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
      const result: DiscoveryRunResult = await res.json()
      setRunResult(result)
      const record: LastSync = {
        at: new Date().toISOString(),
        discovered: result.discovered,
        duplicates: result.duplicates,
        errorCount: result.errors.length,
      }
      try {
        localStorage.setItem(LAST_SYNC_KEY, JSON.stringify(record))
      } catch {
        // ignore storage failures
      }
      setLastSync(record)
      loadStats()
    } catch {
      setRunError('Could not reach the server.')
    } finally {
      setRunning(false)
    }
  }

  if (!profileLoading && !canSync(email)) {
    return <Navigate to="/dashboard" replace />
  }

  return (
    <>
      <header className="page-head">
        <div className="wrap welcome">
          <div>
            <h1>Job sync</h1>
            <p>Pull the latest jobs from all configured sources and see what changed.</p>
            <div className="quick">
              <button type="button" className="btn btn-indigo" onClick={handleRunSync} disabled={running}>
                <ion-icon name="refresh-outline" style={{ fontSize: 15, display: 'inline-block', verticalAlign: 'middle', marginRight: 6 }} />
                {running ? 'Syncing…' : 'Sync now'}
              </button>
            </div>
          </div>
        </div>
      </header>

      <section className="page-pad">
        <div className="wrap bento">
          <div className="tile span-12">
            <h3>Status</h3>
            {statsError && <FormError message={statsError} />}
            <div className="stats">
              <div className="stat2">
                <div className="n">{stats ? stats.totalJobs : '—'}</div>
                <div className="l">Total jobs</div>
              </div>
              <div className="stat2">
                <div className="n">{lastSync ? lastSync.discovered : '—'}</div>
                <div className="l">New in last sync</div>
              </div>
              <div className="stat2">
                <div className="n">{lastSync ? lastSync.duplicates : '—'}</div>
                <div className="l">Duplicates skipped</div>
              </div>
              <div className="stat2">
                <div className="n">{lastSync ? lastSync.errorCount : '—'}</div>
                <div className="l">Source errors</div>
              </div>
            </div>
            <div className="stats" style={{ marginTop: 12 }}>
              <div className="stat2">
                <div className="n" style={{ fontSize: 15 }}>
                  {lastSync ? formatDateTime(lastSync.at) : 'Never'}
                </div>
                <div className="l">Last synced</div>
              </div>
              <div className="stat2">
                <div className="n" style={{ fontSize: 15 }}>
                  {stats ? formatDateTime(stats.mostRecentDiscoveredAt) : '—'}
                </div>
                <div className="l">Most recent job discovered</div>
              </div>
            </div>
          </div>

          <div className="tile span-12">
            <h3>Last run</h3>
            {runError && <FormError message={runError} />}
            {!runError && !runResult && (
              <p style={{ marginTop: 12, color: 'var(--muted-text)', fontSize: 14 }}>
                No sync run in this session yet. Click “Sync now” to pull fresh jobs.
              </p>
            )}
            {runResult && (
              <>
                <p style={{ marginTop: 12, color: 'var(--muted-text)', fontSize: 14 }}>
                  Discovered <b>{runResult.discovered}</b> new job{runResult.discovered === 1 ? '' : 's'}, skipped{' '}
                  <b>{runResult.duplicates}</b> duplicate{runResult.duplicates === 1 ? '' : 's'}.
                </p>
                {runResult.errors.length > 0 && (
                  <ul className="activity" style={{ marginTop: 12 }}>
                    {runResult.errors.map((err, i) => (
                      <li key={i}>
                        <span className="d g" />
                        <span>
                          {err.sourceId}
                          <small>{err.message}</small>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        </div>
      </section>
    </>
  )
}
