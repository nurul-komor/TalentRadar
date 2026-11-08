import { Link } from 'react-router-dom'

export function Footer() {
  return (
    <footer>
      <div className="wrap">
        <div className="foot-row">
          <div className="foot-brand">
            <div className="brand">
              <span className="brand-mark">
                <img src="/logo.png" alt="Hunter" />
              </span>
              Hunter
            </div>
            <p>A verified, scored remote-job feed, with a human approval gate before anything is ever submitted.</p>
          </div>
          <div className="foot-cols">
            <div className="foot-col">
              <h4>Product</h4>
              <Link to="/jobs">Jobs</Link>
              <Link to="/scoring">Scoring</Link>
              <Link to="/sources">Sources</Link>
            </div>
            <div className="foot-col">
              <h4>Account</h4>
              <Link to="/login">Log in</Link>
              <Link to="/register">Create profile</Link>
            </div>
          </div>
        </div>
        <div className="foot-bottom">
          <span>© 2026 Hunter</span>
          <a href="https://www.linkedin.com/in/nurul-komor/" target="_blank" rel="noreferrer">
            Developed by: Nurul Komor
          </a>
        </div>
      </div>
    </footer>
  )
}
