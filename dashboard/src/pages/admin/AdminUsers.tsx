import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Profile } from '@job-hunter/shared'
import { apiFetch } from '../../api/client'
import { useAuth } from '../../auth/AuthContext'
import { isAdmin } from '../../lib/syncAccess'
import { Button } from '../../components/Button'
import { FormError } from '../../components/FormError'
import { Icon } from '../../components/Icon'
import { useScrollReveal } from '../../hooks/useScrollReveal'
import { relativeTimeFromNow, absoluteLocalTime } from '../../lib/relativeTime'

interface UsersResponseBody {
  users: Profile[]
}

type SortKey = 'newest' | 'name'
type FilterKey = 'all' | 'onboarded' | 'cv' | 'admins'

function displayNameFor(user: Profile): string {
  return user.resume?.fullName?.trim() || '—'
}

function initialsFor(user: Profile): string {
  const name = user.resume?.fullName?.trim()
  const source = name && name.length > 0 ? name : user.email
  const parts = source.split(/[\s@._-]+/).filter(Boolean)
  const letters = (parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')
  return (letters || source[0] || '?').toUpperCase()
}

function hasCv(user: Profile): boolean {
  return Boolean(user.cvText || user.cvFileUrl)
}

function isOnboarded(user: Profile): boolean {
  return Boolean(user.onboardingCompletedAt)
}

export function AdminUsersPage() {
  const { email: currentEmail, login } = useAuth()
  const navigate = useNavigate()
  const [users, setUsers] = useState<Profile[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [impersonatingId, setImpersonatingId] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortKey>('newest')
  const [filter, setFilter] = useState<FilterKey>('all')

  const revealRef = useScrollReveal<HTMLDivElement>({ selector: '.jt-table tbody tr', y: 16, stagger: 0.035 })

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

  async function handleImpersonate(userId: string) {
    setError(null)
    setImpersonatingId(userId)
    try {
      const res = await apiFetch(`/admin/users/${userId}/impersonate`, { method: 'POST' })
      if (!res.ok) {
        setError('Could not log in as that user.')
        return
      }
      const { token } = (await res.json()) as { token: string }
      login(token)
      navigate('/dashboard')
    } catch {
      setError('Could not reach the server.')
    } finally {
      setImpersonatingId(null)
    }
  }

  const counts = useMemo(() => {
    const list = users ?? []
    return {
      all: list.length,
      onboarded: list.filter(isOnboarded).length,
      cv: list.filter(hasCv).length,
      admins: list.filter((u) => isAdmin(u.email)).length,
    }
  }, [users])

  const filtered = useMemo(() => {
    let list = users ?? []
    if (filter === 'onboarded') list = list.filter(isOnboarded)
    else if (filter === 'cv') list = list.filter(hasCv)
    else if (filter === 'admins') list = list.filter((u) => isAdmin(u.email))

    const query = search.trim().toLowerCase()
    if (query) {
      list = list.filter(
        (u) =>
          u.email.toLowerCase().includes(query) ||
          (u.resume?.fullName ?? '').toLowerCase().includes(query),
      )
    }

    const sorted = [...list]
    if (sort === 'name') {
      sorted.sort((a, b) => displayNameFor(a).localeCompare(displayNameFor(b)))
    } else {
      sorted.sort((a, b) => {
        const at = a.createdAt ? new Date(a.createdAt).getTime() : 0
        const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0
        return bt - at
      })
    }
    return sorted
  }, [users, filter, search, sort])

  const FILTERS: Array<{ key: FilterKey; label: string; count: number }> = [
    { key: 'all', label: 'All', count: counts.all },
    { key: 'onboarded', label: 'Onboarded', count: counts.onboarded },
    { key: 'cv', label: 'Has CV', count: counts.cv },
    { key: 'admins', label: 'Admins', count: counts.admins },
  ]

  return (
    <>
      <header className="page-head">
        <div className="wrap">
          <div className="kicker">Admin</div>
          <h1>Users</h1>
          <p>Browse registered accounts and log in as a user to debug their session.</p>
        </div>
      </header>

      <section className="page-pad">
        <div className="wrap">
          {error && (
            <div className="mb-4">
              <FormError message={error} />
            </div>
          )}

          {/* Toolbar: search · sort */}
          <div className="jt-toolbar">
            <div className="jt-search">
              <Icon name="search-outline" />
              <input
                type="text"
                placeholder="Search by name or email…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <div className="jt-viewtoggle" role="tablist" aria-label="Sort">
              <button
                type="button"
                role="tab"
                aria-selected={sort === 'newest'}
                className={sort === 'newest' ? 'on' : ''}
                onClick={() => setSort('newest')}
              >
                <Icon name="time-outline" /> Newest
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={sort === 'name'}
                className={sort === 'name' ? 'on' : ''}
                onClick={() => setSort('name')}
              >
                <Icon name="person-outline" /> Name
              </button>
            </div>
          </div>

          {/* Stat row doubles as a filter */}
          <div className="jt-stats">
            {FILTERS.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`jt-stat${filter === item.key ? ' on' : ''}`}
                onClick={() => setFilter(item.key)}
              >
                <div className="n tabular-nums">{users === null ? '—' : item.count}</div>
                <div className="l">{item.label}</div>
              </button>
            ))}
          </div>

          {users === null && !error ? (
            <div className="jt-table-wrap">
              <table className="jt-table">
                <tbody>
                  {Array.from({ length: 5 }).map((_, index) => (
                    <tr key={index}>
                      <td>
                        <div className="jt-cell-co">
                          <span className="sk" style={{ width: 36, height: 36, borderRadius: '50%' }} />
                          <span style={{ display: 'grid', gap: 6 }}>
                            <span className="sk" style={{ width: 160, height: 12 }} />
                            <span className="sk" style={{ width: 110, height: 10 }} />
                          </span>
                        </div>
                      </td>
                      <td>
                        <span className="sk" style={{ width: 120, height: 12 }} />
                      </td>
                      <td>
                        <span className="sk" style={{ width: 90, height: 12 }} />
                      </td>
                      <td>
                        <span className="sk" style={{ width: 110, height: 30, borderRadius: 10, marginLeft: 'auto' }} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : filtered.length === 0 ? (
            <p className="saved-empty">
              <b>No users match</b>
              {search ? `No accounts match "${search}".` : 'No accounts in this view yet.'}
            </p>
          ) : (
            <div className="jt-table-wrap" ref={revealRef}>
              <table className="jt-table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Status</th>
                    <th>Registered</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((user) => {
                    const isSelf = user.email === currentEmail
                    const busy = impersonatingId === user._id
                    const admin = isAdmin(user.email)
                    return (
                      <tr key={user._id ?? user.email}>
                        <td>
                          <div className="jt-cell-co">
                            <span className="avatar" aria-hidden="true">
                              {initialsFor(user)}
                            </span>
                            <span>
                              <b>{displayNameFor(user)}</b>
                              <small style={{ display: 'block' }}>{user.email}</small>
                            </span>
                          </div>
                        </td>
                        <td>
                          <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
                            {admin && <span className="pill mono">Admin</span>}
                            {isOnboarded(user) && <span className="pill">Onboarded</span>}
                            {hasCv(user) && <span className="pill">CV</span>}
                            {!admin && !isOnboarded(user) && !hasCv(user) && (
                              <span className="pill" style={{ opacity: 0.6 }}>
                                New
                              </span>
                            )}
                          </span>
                        </td>
                        <td>
                          {user.createdAt ? (
                            <span title={absoluteLocalTime(user.createdAt)}>
                              {relativeTimeFromNow(user.createdAt)}
                            </span>
                          ) : (
                            'never'
                          )}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <Button
                            variant="ghost"
                            size="default"
                            className="btn-sm inline-flex items-center gap-1.5"
                            disabled={isSelf || busy || impersonatingId !== null || !user._id}
                            onClick={() => user._id && handleImpersonate(user._id)}
                            title={isSelf ? "That's you" : 'Log in as this user'}
                          >
                            <Icon name="enter-outline" size={16} />
                            {isSelf ? 'You' : busy ? 'Logging in…' : 'Login as user'}
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </>
  )
}
