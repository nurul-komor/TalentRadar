import type { Db } from 'mongodb'

export interface AuditEntry {
  action: string
  jobId: string | null
  runNumber: number | null
  actorProfileId: string | null
  details: Record<string, unknown>
}

export async function writeAuditLog(db: Db, entry: AuditEntry): Promise<void> {
  await db.collection('auditLog').insertOne({ ...entry, at: new Date().toISOString() })
}
