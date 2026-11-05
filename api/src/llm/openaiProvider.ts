import OpenAI from 'openai'
import type { LlmProvider, StructuredRequest, StructuredResult } from './types.js'

// OpenAI-backed provider. Uses Chat Completions with a strict `json_schema` response
// format — our hand-written schemas already satisfy OpenAI strict mode (every object has
// `additionalProperties:false` and lists all keys in `required`), so the model is forced
// to return JSON matching the schema, which we then run through the capability's `.parse()`.
export function createOpenaiProvider(apiKey: string): LlmProvider {
  const client = new OpenAI({ apiKey })

  return {
    name: 'openai',
    async complete<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>> {
      const response = await client.chat.completions.create({
        model: request.model,
        max_tokens: request.maxOutputTokens,
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.user },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: request.schemaName,
            schema: request.jsonSchema,
            strict: true,
          },
        },
      })

      const choice = response.choices[0]
      if (choice?.message.refusal) {
        throw new Error(
          `OpenAI refused to produce output for "${request.schemaName}": ${choice.message.refusal}`
        )
      }
      const content = choice?.message.content
      if (!content) {
        throw new Error(`OpenAI did not return content for "${request.schemaName}"`)
      }

      return {
        output: request.parse(content),
        usage: {
          inputTokens: response.usage?.prompt_tokens ?? 0,
          outputTokens: response.usage?.completion_tokens ?? 0,
        },
      }
    },
  }
}
