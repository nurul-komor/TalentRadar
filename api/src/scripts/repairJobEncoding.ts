// One-off backfill: repair mojibake in jobs that were stored before the
// ingestion-time fix (see discovery/textEncoding.ts). Scans every job and
// rewrites title / company / rawDescription / location where the repair
// actually changes the text, leaving clean rows untouched.
//
// Safe to re-run: repairMojibake is idempotent, so a second pass is a no-op.
//
// Dry run (default): npx tsx --env-file=.env src/scripts/repairJobEncoding.ts
// Apply changes:     npx tsx --env-file=.env src/scripts/repairJobEncoding.ts --write
import { connectMongo } from '../db.js'
import { repairMojibake } from '../discovery/textEncoding.js'
import type { Job } from '@job-hunter/shared'

const TEXT_FIELDS = ['title', 'company', 'rawDescription', 'location'] as const

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI
  const dbName = process.env.MONGODB_DB_NAME
  if (!uri || !dbName) {
    throw new Error('MONGODB_URI and MONGODB_DB_NAME must be set')
  }

  const write = process.argv.includes('--write')
  const { client, db } = await connectMongo(uri, dbName)
  const jobs = db.collection<Job>('jobs')

  try {
    let scanned = 0
    let changed = 0
    const fieldCounts: Record<string, number> = {}

    const cursor = jobs.find({})
    for await (const job of cursor) {
      scanned += 1
      const update: Record<string, string | null> = {}

      for (const field of TEXT_FIELDS) {
        const value = job[field]
        if (typeof value !== 'string') continue
        const repaired = repairMojibake(value)
        if (repaired !== value) {
          update[field] = repaired
          fieldCounts[field] = (fieldCounts[field] ?? 0) + 1
        }
      }

      if (Object.keys(update).length === 0) continue
      changed += 1

      if (write) {
        await jobs.updateOne(
          { _id: job._id },
          { $set: { ...update, updatedAt: new Date().toISOString() } }
        )
      } else {
        const sample = update.title ?? update.company ?? update.location ?? '(description)'
        console.log(`[${job.sourceId}/${job.sourceJobId}] -> ${sample}`)
      }
    }

    const perField = TEXT_FIELDS.map((f) => `${f}=${fieldCounts[f] ?? 0}`).join(' ')
    console.log(
      `${write ? 'Repaired' : 'Would repair'} ${changed}/${scanned} jobs. Fields changed: ${perField}`
    )
    if (!write) console.log('Dry run — re-run with --write to apply.')
  } finally {
    await client.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
