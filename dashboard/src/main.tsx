import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './lib/icons'
import './index.css'

// Take scroll position into our own hands. The browser's default 'auto'
// restoration waits until async page content has loaded (profile, job, logos),
// then jumps back to a stale pre-reload offset — on detail pages that lands the
// user in the middle of the description and fights their scroll. 'manual' lets
// the ScrollToTop router helper decide instead.
if ('scrollRestoration' in history) {
  history.scrollRestoration = 'manual'
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
