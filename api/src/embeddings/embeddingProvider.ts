import OpenAI from 'openai'

// A single embedding call returns one vector per input text, plus token usage so the
// caller can account cost through the shared aiUsageService (mirrors LlmProvider usage).
export interface EmbeddingResult {
  vectors: number[][]
  usage: { inputTokens: number }
}

export interface Embedder {
  // The concrete model id used, so callers can price usage (see PRICING in aiUsageService).
  model: string
  // Vector dimensionality — must match the vector search index's numDimensions.
  dimensions: number
  embed(texts: string[]): Promise<EmbeddingResult>
}

// text-embedding-3-small accepts up to 8191 tokens per input. We cap on characters as a
// cheap, dependency-free guard (~4 chars/token → ~32k chars is comfortably under the limit);
// over-long job descriptions are truncated rather than rejected.
const MAX_INPUT_CHARS = 30_000

function truncate(text: string): string {
  return text.length > MAX_INPUT_CHARS ? text.slice(0, MAX_INPUT_CHARS) : text
}

// OpenAI-backed embedder. Independent of LLM_PROVIDER — embeddings always use OpenAI
// because Anthropic has no embeddings API. Client setup mirrors llm/openaiProvider.ts.
export function createOpenAiEmbedder(
  apiKey: string,
  model: string,
  dimensions: number
): Embedder {
  const client = new OpenAI({ apiKey })

  return {
    model,
    dimensions,
    async embed(texts: string[]): Promise<EmbeddingResult> {
      if (texts.length === 0) {
        return { vectors: [], usage: { inputTokens: 0 } }
      }
      const response = await client.embeddings.create({
        model,
        input: texts.map(truncate),
      })
      // The API preserves input order; sort by index defensively before mapping.
      const vectors = [...response.data]
        .sort((a, b) => a.index - b.index)
        .map((d) => d.embedding as number[])
      return {
        vectors,
        usage: { inputTokens: response.usage?.prompt_tokens ?? 0 },
      }
    },
  }
}
