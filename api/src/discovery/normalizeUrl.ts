export function normalizeUrl(rawUrl: string): string {
  const url = new URL(rawUrl)
  const host = url.hostname.toLowerCase()
  let path = url.pathname
  if (path.length > 1 && path.endsWith('/')) {
    path = path.slice(0, -1)
  }
  return `${url.protocol}//${host}${path}`
}
