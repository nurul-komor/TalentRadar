import type { Embedder } from '../../src/embeddings/embeddingProvider'

// Deterministic, offline embedder for tests: a bag-of-words count over a fixed vocabulary.
// Cosine similarity over these vectors tracks shared keywords, so a "python backend" resume
// scores higher against a Python job than against a design job — enough to assert ranking
// without any network/model. Also records every embed() call for cache assertions.
const VOCAB = [
  'python',
  'backend',
  'django',
  'api',
  'react',
  'frontend',
  'typescript',
  'design',
  'figma',
  'kubernetes',
  'aws',
  'sql',
]

export interface MockEmbedder extends Embedder {
  calls: string[][]
}

export function createMockEmbedder(): MockEmbedder {
  const calls: string[][] = []
  return {
    model: 'text-embedding-3-small',
    dimensions: VOCAB.length,
    calls,
    async embed(texts: string[]) {
      calls.push(texts)
      const vectors = texts.map((text) => {
        const lower = text.toLowerCase()
        return VOCAB.map((word) => {
          const matches = lower.match(new RegExp(`\\b${word}\\b`, 'g'))
          return matches ? matches.length : 0
        })
      })
      return { vectors, usage: { inputTokens: texts.join(' ').length } }
    },
  }
}
