import { Icon } from '../components/Icon'
import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import type { PublicJobsSummary } from '@job-hunter/shared'
import { apiFetch } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { FormError } from '../components/FormError'
import { ThemeToggle } from '../components/ThemeToggle'
import { LogoChip } from '../components/LogoChip'
import { Pill } from '../components/Pill'

const SOURCE_LABELS: Record<string, string> = {
  remoteok: 'Remote OK',
  weworkremotely: 'We Work Remotely',
  himalayas: 'Himalayas',
  'teletalk-govt': 'alljobs.teletalk.com.bd',
  'brainstation-23': 'Brain Station 23',
  'riseup-labs': 'Riseup Labs',
  enosis: 'Enosis Solutions',
  bdtask: 'Bdtask',
  selise: 'SELISE Digital Platforms',
  bjit: 'BJIT Limited',
  cefalo: 'Cefalo Bangladesh',
  vivasoft: 'Vivasoft Limited',
  dsinnovators: 'Dynamic Solution Innovators',
}

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const redirectTo = (location.state as { from?: string } | null)?.from ?? '/jobs'
  const [summary, setSummary] = useState<PublicJobsSummary | null>(null)

  useEffect(() => {
    apiFetch('/public/jobs-summary')
      .then((res) => (res.ok ? (res.json() as Promise<PublicJobsSummary>) : null))
      .then(setSummary)
      .catch(() => setSummary(null))
  }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const res = await apiFetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'login failed' }))
        setError(body.error ?? 'login failed')
        return
      }
      const { token } = await res.json()
      login(token)
      navigate(redirectTo, { replace: true })
    } catch {
      setError('Could not reach the server. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="auth">
      <div className="auth-form-side">
        <div className="auth-top">
          <Link to="/" className="brand">
            <span className="brand-mark">
              <img src="/logo.png" alt="Hunter" />
            </span>
            Hunter
          </Link>
          <ThemeToggle />
        </div>

        <div className="auth-form-wrap">
          <h1>Welcome back</h1>
          <p className="sub">Log in to keep tracking verified roles and your application pipeline.</p>

          <form onSubmit={handleSubmit} className="auth-form">
            {error && <FormError message={error} />}

            <div className="field">
              <label htmlFor="email">Email</label>
              <div className="in">
                <Icon name="mail-outline" />
                <input
                  id="email"
                  type="email"
                  name="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="field">
              <label htmlFor="password">Password</label>
              <div className="in">
                <Icon name="lock-closed-outline" />
                <input
                  id="password"
                  type="password"
                  name="password"
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
            </div>

            <label className="terms">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />
              Keep me logged in on this device
            </label>

            <button type="submit" className={`btn btn-primary ${submitting ? 'loading' : ''}`} disabled={submitting}>
              Log in
            </button>
          </form>

          <p className="form-note" style={{ marginTop: 20 }}>
            Need an account? <Link to="/register">Create one</Link>
          </p>
        </div>
      </div>

      <div className="auth-brand">
        <div className="hero-bg" />
        <div className="hero-glow" />
        <div className="brand-copy">
          <span className="recheck">
            <i />
            Live re-check on every listing
          </span>
          <h2>Your pipeline, picked up right where you left it.</h2>
          <p>
            Saved jobs, match scores, and application status are waiting for you — nothing re-submits
            without your approval.
          </p>

          {summary && summary.featuredJobs.length > 0 && (
            <div className="stack" aria-hidden="true">
              {summary.featuredJobs.slice(0, 2).map((job, index) => (
                <div className={`fcard c${index + 1}`} key={job._id}>
                  <div className="fcard-top">
                    <div className="fcard-co">
                      <LogoChip name={job.company} />
                      <div>
                        <div className="fcard-role">{job.title}</div>
                        <div className="fcard-co-name">{job.company}</div>
                      </div>
                    </div>
                  </div>
                  <div className="fcard-meta">
                    <Pill tone="verified">Verified open</Pill>
                    <Pill tone="mono">{SOURCE_LABELS[job.sourceId] ?? job.sourceId}</Pill>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
