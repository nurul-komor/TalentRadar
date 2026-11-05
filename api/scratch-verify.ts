import { serve } from '@hono/node-server'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { createApp } from './src/app.js'
import { connectMongo } from './src/db.js'
import { mountRoutes } from './src/mountRoutes.js'

async function main() {
  const mongod = await MongoMemoryServer.create()
  const { db } = await connectMongo(mongod.getUri(), 'verify')

  const now = new Date().toISOString()
  await db.collection('jobs').insertMany([
    { sourceId: 'remoteok', sourceJobId: 'v1', normalizedUrl: 'https://example.com/1', title: 'Senior Backend Engineer', company: 'Acme Corp', rawDescription: 'd', location: 'Remote - US', salaryMin: 120000, salaryMax: 160000, postedAt: now, status: 'verified', discoveredAt: now, updatedAt: now, verifiedAt: now, verificationEvidence: null, contentHash: null, extractedRequirements: null, extractedAt: null, score: null, scoreBreakdown: null, scoredAt: null },
    { sourceId: 'weworkremotely', sourceJobId: 'v2', normalizedUrl: 'https://example.com/2', title: 'Frontend Developer', company: 'Widgets Inc', rawDescription: 'd', location: 'Remote - Europe', salaryMin: null, salaryMax: null, postedAt: now, status: 'verified', discoveredAt: now, updatedAt: now, verifiedAt: now, verificationEvidence: null, contentHash: null, extractedRequirements: null, extractedAt: null, score: null, scoreBreakdown: null, scoredAt: null },
    { sourceId: 'himalayas', sourceJobId: 'v3', normalizedUrl: 'https://example.com/3', title: 'DevOps Engineer', company: 'CloudCo', rawDescription: 'd', location: null, salaryMin: 90000, salaryMax: 130000, postedAt: now, status: 'verified', discoveredAt: now, updatedAt: now, verifiedAt: now, verificationEvidence: null, contentHash: null, extractedRequirements: null, extractedAt: null, score: null, scoreBreakdown: null, scoredAt: null },
    { sourceId: 'remoteok', sourceJobId: 'v4', normalizedUrl: 'https://example.com/4', title: 'Product Designer', company: 'DesignHub', rawDescription: 'd', location: 'Remote - Worldwide', salaryMin: null, salaryMax: null, postedAt: now, status: 'verified', discoveredAt: now, updatedAt: now, verifiedAt: now, verificationEvidence: null, contentHash: null, extractedRequirements: null, extractedAt: null, score: null, scoreBreakdown: null, scoredAt: null },
    { sourceId: 'remoteok', sourceJobId: 'v5', normalizedUrl: 'https://example.com/5', title: 'Data Scientist', company: 'DataWorks', rawDescription: 'd', location: 'Remote', salaryMin: null, salaryMax: null, postedAt: now, status: 'discovered', discoveredAt: now, updatedAt: now, verifiedAt: null, verificationEvidence: null, contentHash: null, extractedRequirements: null, extractedAt: null, score: null, scoreBreakdown: null, scoredAt: null },
  ])

  const app = mountRoutes(createApp(), db, 'test-secret', 'test-cron-secret', null)
  serve({ fetch: app.fetch, port: 8798 }, () => {
    console.log('verify API listening on http://localhost:8798')
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
