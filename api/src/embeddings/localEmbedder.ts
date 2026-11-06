import type { Embedder, EmbeddingResult } from './embeddingProvider.js'

// Local, API-key-free embedder backed by @huggingface/transformers ("manual" mode in the
// vector manager). The model runs in-process via ONNX Runtime; weights are downloaded from
// the HF hub on first use and cached to disk, so the first embed call is slow and later ones
// are fast. Deliberately mirrors createOpenAiEmbedder's Embedder shape so the rest of the
// suggestion/vector pipeline is identical regardless of how vectors are produced.

// all-MiniLM-L6-v2 is the de-facto default sentence-embedding model: small, fast on CPU,
// and 384-dimensional. The Xenova/* repos ship the ONNX weights transformers.js needs.
export const DEFAULT_LOCAL_EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2'

// Known output dimensionality for the local models we support, so the vector index can be
// sized without loading the model first. Falls back to probing the model when unlisted.
const KNOWN_DIMENSIONS: Record<string, number> = {
  'Xenova/all-MiniLM-L6-v2': 384,
  'Xenova/all-MiniLM-L12-v2': 384,
  'Xenova/bge-small-en-v1.5': 384,
  'Xenova/bge-base-en-v1.5': 768,
  'Xenova/gte-small': 384,
}

export function localEmbeddingDimensions(model: string): number {
  return KNOWN_DIMENSIONS[model] ?? 384
}

// transformers.js's feature-extraction pipeline, created lazily and reused. Typed loosely
// because the package is ESM-only and we import it dynamically to keep it out of the startup
// path (and off the critical path for deployments that only ever use the OpenAI embedder).
type FeatureExtractor = (
  texts: string[],
  options: { pooling: 'mean'; normalize: boolean }
) => Promise<{ tolist(): number[][] }>

export function createLocalEmbedder(model: string, dimensions: number): Embedder {
  let extractorPromise: Promise<FeatureExtractor> | null = null

  async function getExtractor(): Promise<FeatureExtractor> {
    if (!extractorPromise) {
      extractorPromise = import('@huggingface/transformers').then(({ pipeline }) =>
        pipeline('feature-extraction', model)
      ) as Promise<FeatureExtractor>
    }
    return extractorPromise
  }

  return {
    model,
    dimensions,
    async embed(texts: string[]): Promise<EmbeddingResult> {
      if (texts.length === 0) return { vectors: [], usage: { inputTokens: 0 } }
      const extractor = await getExtractor()
      // Mean-pool token embeddings into one vector per input and L2-normalize so cosine
      // similarity matches the OpenAI path's geometry.
      const output = await extractor(texts, { pooling: 'mean', normalize: true })
      const vectors = output.tolist()
      // Local inference has no API cost; report zero token usage so the shared budget/usage
      // accounting (recordUsage/isWithinBudget) treats manual embeddings as free.
      return { vectors, usage: { inputTokens: 0 } }
    },
  }
}
