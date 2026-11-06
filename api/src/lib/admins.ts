// Operator/admin accounts. Admin-only routes (the /admin router, force-resync,
// discovery) gate on membership in this list, both here server-side and in the
// dashboard UI. Add an email here to grant a user admin access.
export const ADMIN_EMAILS = ['nurulkomor123@gmail.com']

export function isAdmin(email: string | null | undefined): boolean {
  return email != null && ADMIN_EMAILS.includes(email)
}
