// One-off backfill: re-scrape every bdtask posting with the current (fixed)
// source logic and refresh the stored rawDescription/location for jobs that were
// saved before the multi-section fix. Discovery itself skips existing jobs as
// duplicates, so stale records never get updated through the normal run — this
// script updates them in place.
//
// Run: npx tsx --env-file=.env src/scripts/backfillBdtaskDescriptions.ts
import { connectMongo } from '../db.js'
import { bdtaskSource } from '../discovery/sources/bdtask.js'
import type { Job } from '@job-hunter/shared'

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI
  const dbName = process.env.MONGODB_DB_NAME
  if (!uri || !dbName) {
    throw new Error('MONGODB_URI and MONGODB_DB_NAME must be set')
  }

  const { client, db } = await connectMongo(uri, dbName)
  const jobs = db.collection<Job>('jobs')

  try {
    const postings = await bdtaskSource.fetchJobs()
    console.log(`Fetched ${postings.length} bdtask postings.`)

    let updated = 0
    let unchanged = 0
    let missing = 0

    for (const posting of postings) {
      if (!posting.rawDescription) continue

      const existing = await jobs.findOne({
        sourceId: 'bdtask',
        sourceJobId: posting.sourceJobId,
      })
      if (!existing) {
        missing += 1
        continue
      }

      if (existing.rawDescription === posting.rawDescription) {
        unchanged += 1
        continue
      }

      await jobs.updateOne(
        { _id: existing._id },
        {
          $set: {
            rawDescription: posting.rawDescription,
            location: posting.location,
            updatedAt: new Date().toISOString(),
          },
        }
      )
      updated += 1
      console.log(
        `Updated ${posting.sourceJobId}: ${existing.rawDescription.length} -> ${posting.rawDescription.length} chars`
      )
    }

    console.log(
      `Done. updated=${updated} unchanged=${unchanged} not-in-db=${missing}`
    )
  } finally {
    await client.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
