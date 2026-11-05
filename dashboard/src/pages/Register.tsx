import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate, Link } from 'react-router-dom'
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

function passwordStrength(password: string): number {
  let level = 0
  if (password.length >= 8) level += 1
  if (/[A-Z]/.test(password)) level += 1
  if (/[0-9]/.test(password)) level += 1
  if (/[^A-Za-z0-9]/.test(password)) level += 1
  return level
}

export function RegisterPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const { login } = useAuth()
  const navigate = useNavigate()
  const [summary, setSummary] = useState<PublicJobsSummary | null>(null)

  useEffect(() => {
    apiFetch('/public/jobs-summary')
      .then((res) => (res.ok ? (res.json() as Promise<PublicJobsSummary>) : null))
      .then(setSummary)
      .catch(() => setSummary(null))
  }, [])

  const strength = useMemo(() => passwordStrength(password), [password])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setConfirmError(null)

    if (password !== confirmPassword) {
      setConfirmError('Passwords do not match.')
      return
    }

    setSubmitting(true)
    try {
      const res = await apiFetch('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'registration failed' }))
        setError(body.error ?? 'registration failed')
        return
      }
      const { token } = await res.json()
      login(token)
      navigate('/jobs')
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
              <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12l5 5L20 6" />
              </svg>
            </span>
            Hunter
          </Link>
          <ThemeToggle />
        </div>

        <div className="auth-form-wrap">
          <div className="steps-mini" aria-hidden="true">
            <span className="on" />
            <span />
          </div>

          <h1>Create your account</h1>
          <p className="sub">Start automating your remote job search.</p>

          <form onSubmit={handleSubmit} className="auth-form">
            {error && <FormError message={error} />}

            <div className="field">
              <label htmlFor="email">Email</label>
              <div className="in">
                <ion-icon name="mail-outline" />
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
                <ion-icon name="lock-closed-outline" />
                <input
                  id="password"
                  type="password"
                  name="password"
                  autoComplete="new-password"
                  placeholder="At least 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={8}
                  required
                />
              </div>
              <div className="pw-meter" data-level={strength} aria-hidden="true">
                <i />
                <i />
                <i />
                <i />
              </div>
            </div>

            <div className={`field ${confirmError ? 'invalid' : ''}`}>
              <label htmlFor="confirmPassword">Confirm password</label>
              <div className="in">
                <ion-icon name="lock-closed-outline" />
                <input
                  id="confirmPassword"
                  type="password"
                  name="confirmPassword"
                  autoComplete="new-password"
                  placeholder="Re-enter your password"
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value)
                    setConfirmError(null)
                  }}
                  minLength={8}
                  required
                />
              </div>
              {confirmError && <div className="err">{confirmError}</div>}
            </div>

            <label className="terms">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                required
              />
              I understand this account will be used to apply for real jobs, and nothing gets
              submitted without my approval.
            </label>

            <button type="submit" className={`btn btn-primary ${submitting ? 'loading' : ''}`} disabled={submitting || !agreed}>
              Create account
            </button>
          </form>

          <p className="form-note" style={{ marginTop: 20 }}>
            Already have an account? <Link to="/login">Log in</Link>
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
          <h2>Build your profile once. Stop refreshing ten job boards a day.</h2>
          <p>
            We discover postings across the web, re-verify each one against its live source, then
            score the match against your profile — so you only spend time on roles worth applying to.
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
