import { PublicNav } from '../components/Nav'
import { Footer } from '../components/Footer'
import { useScrollReveal } from '../hooks/useScrollReveal'

interface FaqEntry {
  q: string
  a: string
}

const FAQS: FaqEntry[] = [
  {
    q: 'Can anything auto-submit an application without me?',
    a: 'No, never. Submitting is a two-step gate: you approve a specific automation run, then a separate submit step re-checks that same approval from scratch before it ever clicks a submit button. There is no path that skips your approval.',
  },
  {
    q: "What happens if a listing's source page no longer confirms it's open?",
    a: "Verification re-fetches the listing's own source page and only promotes it once that page itself still shows it as open. A page that no longer backs up the listing gets rejected instead, and a rejected listing is never scored or shown as actionable.",
  },
  {
    q: 'What if I approve a run and then one of my required answers changes?',
    a: "Approval is scoped to that specific run. The submit step re-checks your required answers against the live application record at the moment it runs — not just at the moment you approved — so it never trusts a stale approval on its own.",
  },
  {
    q: 'Why would a job score low even though it looks like a decent fit?',
    a: 'Unknown or missing information pulls the score down rather than being ignored — a listing with no salary shown or no clear remote policy scores worse than one that states those things plainly, even if the role itself might be fine. See the Scoring page for the exact numbers.',
  },
  {
    q: 'Do Bangladesh government circulars go through the same pipeline?',
    a: "They're discovered the same way every other source is, but they're excluded from the verification and scoring stages — a government circular doesn't map onto a work-authorization, remote-type, or salary field the way a conventional listing does. See the Sources page for how we handle them instead.",
  },
]

export function HowItWorksPage() {
  const pipelineRevealRef = useScrollReveal<HTMLDivElement>({ selector: '.reveal-pnode' })

  return (
    <div>
      <PublicNav />

      <section className="page-head">
        <div className="wrap">
          <div className="kicker">How it works</div>
          <h1>Four stages. One gate you control.</h1>
          <p>
            Every listing you see moved through the same pipeline — discovered, re-verified against
            its own source, scored against your profile, and only turned into application materials
            once you ask for them.
          </p>
        </div>
      </section>

      <section className="band">
        <div className="wrap">
          <div ref={pipelineRevealRef} className="pipeline">
            <div className="pnode reveal-pnode">
              <div className="num">01</div>
              <h3>Discover</h3>
              <p>A cron-triggered endpoint runs every source adapter and writes new postings into the job store with status discovered — there's no manual entry step.</p>
            </div>
            <div className="pnode reveal-pnode">
              <div className="num">02</div>
              <h3>Verify</h3>
              <p>Each discovered listing is re-fetched from its own live source page before it's trusted any further.</p>
              <div className="detail">
                <span className="bad">A 200 response alone proves nothing</span>
                <br />
                <span className="ok">Page content is re-checked against the source</span>
              </div>
            </div>
            <div className="pnode reveal-pnode">
              <div className="num">03</div>
              <h3>Score</h3>
              <p>Only verified listings are scored — a deterministic formula weighs work authorization, remote fit, salary, skills, and location against your profile.</p>
            </div>
            <div className="pnode hot reveal-pnode">
              <div className="num">04</div>
              <h3>Materials &amp; approve</h3>
              <p>Tailored materials are drafted only when you ask for them. Nothing is sent until you confirm, twice.</p>
              <div className="detail">
                <span className="ok">Draft → your review → approve → submit (re-checked)</span>
              </div>
            </div>
          </div>

          <div className="gate">
            <div>
              <h2>Nothing reaches <span className="mono">submitted</span> without your explicit confirmation.</h2>
              <p>
                This is a hard invariant in the backend, not a marketing line. Submitting is split into
                two separate steps: you approve a specific automation run, and a later, independent
                submit step re-checks that approval from first principles before it acts — it never
                assumes the approval it's handed is still valid just because it exists.
              </p>
            </div>
            <ul className="score-list">
              <li>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
                Materials are drafted from your profile and the job listing, only on request.
              </li>
              <li>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
                You review every required answer before anything is approved.
              </li>
              <li>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
                Approving a run is explicit — there is no default-yes.
              </li>
              <li>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
                The submit step re-checks that approval on its own before it ever clicks submit.
              </li>
            </ul>
          </div>

          <div className="faq">
            {FAQS.map((entry) => (
              <details key={entry.q}>
                <summary>
                  {entry.q}
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </summary>
                <div className="a">{entry.a}</div>
              </details>
            ))}
          </div>
        </div>
      </section>

      <Footer />
    </div>
  )
}
