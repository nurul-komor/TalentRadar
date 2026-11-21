// Single source of truth for the Hunter brand lockup (mark + wordmark).
// Rendered inside each surface's own link/wrapper (nav, sidebar, footer, auth),
// so changing the brand is a one-file edit. Reuses the shared .brand / .brand-mark
// styles for consistent sizing across every surface.
export function Logo({ withWordmark = true }: { withWordmark?: boolean }) {
  return (
    <>
      <span className="brand-mark" aria-hidden={withWordmark || undefined}>
        <img src="/logo.png" alt={withWordmark ? '' : 'Hunter'} />
      </span>
      {withWordmark && 'Hunter'}
    </>
  )
}
