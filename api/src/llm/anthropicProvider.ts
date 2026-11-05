import Anthropic from '@anthropic-ai/sdk'
import type { LlmProvider, StructuredRequest, StructuredResult } from './types.js'

// Anthropic-backed provider. Uses `messages.parse` with `output_config.format` so the
// SDK validates the response against our JSON Schema via the supplied `.parse()` — the
// same call shape the capabilities used before the provider abstraction existed.
export function createAnthropicProvider(apiKey: string): LlmProvider {
  const client = new Anthropic({ apiKey })

  return {
    name: 'anthropic',
    async complete<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>> {
      const response = await client.messages.parse({
        model: request.model,
        max_tokens: request.maxOutputTokens,
        // Claude reasoning models accept adaptive extended thinking; harmless to omit otherwise.
        ...(request.reasoning ? { thinking: { type: 'adaptive' as const } } : {}),
        system: request.system,
        messages: [{ role: 'user', content: request.user }],
        output_config: {
          format: {
            type: 'json_schema' as const,
            schema: request.jsonSchema,
            parse: request.parse,
          },
        },
      })

      if (!response.parsed_output) {
        throw new Error(
          `Anthropic did not return parseable output for "${request.schemaName}"`
        )
      }

      return {
        output: response.parsed_output as T,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
      }
    },
  }
}
