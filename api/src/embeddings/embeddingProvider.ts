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

// text-embedding-3-small accepts up to 8191 tokens per input. Token density varies wildly by
// script — ASCII English is ~4 chars/token, but Bangla/CJK can be ~1 token *per character* or
// worse — so a flat character cap can't guarantee the limit. Instead we estimate tokens from a
// per-character cost (ASCII cheap, non-ASCII expensive) and truncate to a safe budget below the
// hard limit. A dependency-free estimate, deliberately conservative so the API never rejects.
const MAX_INPUT_TOKENS = 6000

function estimatedTokenCost(charCode: number): number {
  // < 128: ASCII — roughly a quarter token per char. Otherwise assume ~4 tokens/char: Bangla
  // and other complex scripts can tokenize to several tokens per character in cl100k, so we
  // stay deliberately pessimistic to keep well under the hard 8191-token limit.
  return charCode < 128 ? 0.25 : 4
}

function truncate(text: string): string {
  let budget = MAX_INPUT_TOKENS
  for (let i = 0; i < text.length; i += 1) {
    budget -= estimatedTokenCost(text.charCodeAt(i))
    if (budget <= 0) return text.slice(0, i)
  }
  return text
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
