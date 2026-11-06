// Operator/admin accounts. Admin-only UI (the Job Sync page, discovery triggers,
// admin views) gates on membership in this list. Add an email here to grant a
// user admin access. Must stay in sync with the API's ADMIN_EMAILS.
export const ADMIN_EMAILS = ['nurulkomor123@gmail.com']

export function isAdmin(email: string | null | undefined): boolean {
  return email != null && ADMIN_EMAILS.includes(email)
}

// Sync access is admin-gated; kept as a named alias for the sync UI call sites.
export const canSync = isAdmin
