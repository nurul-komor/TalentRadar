// Email allowed to access the job sync page / trigger discovery syncs from the UI.
export const SYNC_EMAIL = 'nurulkomr123@gmail.com'

export function canSync(email: string | null): boolean {
  return email === SYNC_EMAIL
}
