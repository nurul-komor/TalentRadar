import { PublicNav } from '../components/Nav'
import { Footer } from '../components/Footer'
import { ScoreRing } from '../components/ScoreRing'
import { useScrollReveal } from '../hooks/useScrollReveal'

interface FactorCard {
  cap: number
  title: string
  rule: string
}

const FACTORS: FactorCard[] = [
  {
    cap: 30,
    title: 'Work authorization fit',
    rule: "Citizens and permanent residents max this out. If you need a visa, a listing that confirms sponsorship is available also maxes out; one open to any work authorization gets partial credit; citizen-only listings score zero. Unknown eligibility, or a listing that doesn't say, scores a flat 10.",
  },
  {
    cap: 20,
    title: 'Remote fit',
    rule: "Only matters if your profile requires remote-only — otherwise this always scores full. When you do require remote: fully remote listings max out, hybrid gets a small partial, onsite scores zero, and an unspecified remote type gets a flat 10.",
  },
  {
    cap: 20,
    title: 'Salary fit',
    rule: "No minimum salary set on your profile maxes this out by default. A listing with no salary at all is a partial miss — 5 points, not neutral. Otherwise it's all or nothing: full points if the listed salary clears your minimum, zero if it doesn't.",
  },
  {
    cap: 20,
    title: 'Skill match',
    rule: "The fraction of the job's required skills found as substrings in your uploaded CV text, scaled to this cap. A listing with no required skills gets a flat partial score. No CV on file scores zero, every time.",
  },
  {
    cap: 10,
    title: 'Location fit',
    rule: "No location preferences on your profile maxes this out. A listing with no location field gets a small partial. Otherwise it's all or nothing: full points if the job's location text contains one of your preferred locations, zero if not.",
  },
]

interface TierCard {
  score: number
  label: string
  description: string
}

const TIERS: TierCard[] = [
  {
    score: 88,
    label: 'Strong match (80+)',
    description: 'Authorization, remote fit, and most other factors are lining up — worth prioritizing.',
  },
  {
    score: 65,
    label: 'Worth a look (50–79)',
    description: 'A real match with at least one meaningful gap — a salary miss, partial skill overlap, or similar.',
  },
  {
    score: 32,
    label: 'Likely a poor fit (under 50)',
    description: 'Something is actively working against the match — a hard authorization or remote mismatch, usually.',
  },
]

interface LedgerRow {
  factor: string
  points: number
  cap: number
  why: string
}

const WORKED_ROWS: LedgerRow[] = [
  {
    factor: 'Work authorization',
    points: 30,
    cap: 30,
    why: 'Visa required, but the listing confirms sponsorship is available — treated the same as a citizen match.',
  },
  {
    factor: 'Remote fit',
    points: 5,
    cap: 20,
    why: 'Candidate requires remote-only; this role is hybrid, so it gets the hybrid partial, not zero.',
  },
  {
    factor: 'Salary fit',
    points: 0,
    cap: 20,
    why: "Listing's max ($65k) falls short of the candidate's $70k minimum — an all-or-nothing miss.",
  },
  {
    factor: 'Skill match',
    points: 13,
    cap: 20,
    why: '2 of 3 required skills (TypeScript, GraphQL) found in the CV text; Kubernetes wasn\'t — 2/3 of the cap, rounded.',
  },
  {
    factor: 'Location fit',
    points: 10,
    cap: 10,
    why: "Job location text contains one of the candidate's preferred locations (Berlin).",
  },
]

const WORKED_TOTAL = WORKED_ROWS.reduce((sum, row) => sum + row.points, 0)

export function ScoringPage() {
  const weightsRevealRef = useScrollReveal<HTMLDivElement>({ selector: '.reveal-wcard' })
  const tiersRevealRef = useScrollReveal<HTMLDivElement>({ selector: '.reveal-tier' })

  return (
    <div>
      <PublicNav />

      <section className="page-head">
        <div className="wrap">
          <div className="kicker">Scoring</div>
          <h1>How every job gets scored against your profile.</h1>
          <p>
            The score is additive across five factors, each with its own point cap. No percentages,
            no weighted guesswork — capped points, added together, out of 100.
          </p>
        </div>
      </section>

      <section className="band">
        <div className="wrap">
          <div className="formula">
            <span className="w">score</span> = <span className="k">workAuth</span>(30) +{' '}
            <span className="k">remote</span>(20) + <span className="k">salary</span>(20) +{' '}
            <span className="k">skills</span>(20) + <span className="k">location</span>(10)
          </div>

          <div ref={weightsRevealRef} className="weights">
            {FACTORS.map((factor) => (
              <div className="wcard reveal-wcard" key={factor.title}>
                <div className="pct">
                  {factor.cap}
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--muted-text)', marginLeft: 4 }}>
                    pts
                  </span>
                </div>
                <h3>{factor.title}</h3>
                <p>{factor.rule}</p>
                <div className="track">
                  <i style={{ width: `${(factor.cap / 30) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>

          <div className="section-head" style={{ marginTop: 72, marginBottom: 0 }}>
            <div className="kicker">Reading the score</div>
            <h2>What the number means.</h2>
            <p>
              These bands are a reading convention for this page, not a database-enforced tier — the
              backend only ever stores the 0–100 score and its five-factor breakdown. It never labels
              anything "strong" or "weak."
            </p>
          </div>
          <div ref={tiersRevealRef} className="tiers">
            {TIERS.map((tier) => (
              <div className="tier reveal-tier" key={tier.label}>
                <ScoreRing score={tier.score} size={52} strokeWidth={4} />
                <div>
                  <b>{tier.label}</b>
                  <span>{tier.description}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="worked">
            <div>
              <div className="kicker">Worked example</div>
              <h2>A visa-required candidate against a hybrid role.</h2>
              <p style={{ color: 'var(--muted-text)', marginTop: 12, fontSize: 15.5, lineHeight: 1.6 }}>
                Candidate: visa-required work authorization, remote-only preference, a $70,000 salary
                minimum, a CV on file, and a preference for Berlin. Job: sponsorship available, hybrid,
                salary listed up to $65,000, three required skills, located in Berlin.
              </p>
            </div>
            <div className="ledger">
              <table>
                <thead>
                  <tr>
                    <th>Factor</th>
                    <th>Points</th>
                  </tr>
                </thead>
                <tbody>
                  {WORKED_ROWS.map((row) => (
                    <tr key={row.factor}>
                      <td>
                        {row.factor}
                        <span className="why">{row.why}</span>
                      </td>
                      <td className="num mono">
                        {row.points} / {row.cap}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Total</td>
                    <td className="num mono">{WORKED_TOTAL} / 100</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  )
}
