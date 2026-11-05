// Provider-agnostic LLM layer. Each AI capability (resume extraction, requirements
// extraction, materials generation) depends only on this interface, never on a
// concrete SDK — so the provider (Anthropic / OpenAI) and the model are chosen by
// config at wiring time (see ./config.ts) rather than hardcoded per capability.

export interface LlmUsage {
  inputTokens: number
  outputTokens: number
}

// A single-turn, schema-validated structured-output request. All three capabilities
// build one system prompt + one user message and want JSON that validates against a
// shared Zod schema, so that is the only shape the providers need to support.
export interface StructuredRequest<T> {
  model: string
  system: string
  user: string
  maxOutputTokens: number
  // `schemaName` is required by OpenAI's json_schema format; Anthropic ignores it.
  schemaName: string
  jsonSchema: Record<string, unknown>
  // Validates (and narrows) the raw model output. Providers that parse natively
  // (Anthropic's `messages.parse`) hand this to the SDK; others call it directly.
  parse: (raw: string) => T
  // Ask the provider for extended thinking / reasoning when the model supports it.
  // Providers whose selected model has no reasoning mode ignore this.
  reasoning?: boolean
}

export interface StructuredResult<T> {
  output: T
  usage: LlmUsage
}

export type ProviderName = 'anthropic' | 'openai' | 'gemini'

export interface LlmProvider {
  readonly name: ProviderName
  complete<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>>
}
