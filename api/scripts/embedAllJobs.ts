import { connectMongo } from '../src/db.js'
import { createEmbeddingConfig } from '../src/llm/config.js'
import { createOpenAiEmbedder } from '../src/embeddings/embeddingProvider.js'
import { embedJobs } from '../src/suggestions/embeddingService.js'

const cfg = createEmbeddingConfig(process.env)
if (!cfg) throw new Error('OPENAI_API_KEY missing — cannot embed')

const embedder = createOpenAiEmbedder(cfg.apiKey, cfg.model, cfg.dimensions)
const { client, db } = await connectMongo(
  process.env.MONGODB_URI!,
  process.env.MONGODB_DB_NAME ?? 'job_hunter'
)

const result = await embedJobs(db, embedder, { force: false })
console.log('embedJobs result:', JSON.stringify(result))

await client.close()
process.exit(0)
