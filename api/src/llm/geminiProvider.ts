import { GoogleGenAI } from '@google/genai'
import type { LlmProvider, StructuredRequest, StructuredResult } from './types.js'

// Gemini-backed provider. Uses `responseMimeType: 'application/json'` + `responseJsonSchema`
// (the field that accepts a standard JSON Schema) so Gemini returns JSON matching our
// schema, which we then run through the capability's `.parse()`.
export function createGeminiProvider(apiKey: string): LlmProvider {
  const client = new GoogleGenAI({ apiKey })

  return {
    name: 'gemini',
    async complete<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>> {
      const response = await client.models.generateContent({
        model: request.model,
        contents: request.user,
        config: {
          systemInstruction: request.system,
          responseMimeType: 'application/json',
          responseJsonSchema: request.jsonSchema,
          maxOutputTokens: request.maxOutputTokens,
          // `reasoning` is intentionally not wired to thinkingConfig here: thinking support
          // varies by Gemini model and passing an unsupported budget errors, so we leave it
          // to each model's default behavior (mirrors the non-reasoning OpenAI path).
        },
      })

      const text = response.text
      if (!text) {
        throw new Error(`Gemini did not return content for "${request.schemaName}"`)
      }

      const usage = response.usageMetadata
      return {
        output: request.parse(text),
        usage: {
          inputTokens: usage?.promptTokenCount ?? 0,
          outputTokens: usage?.candidatesTokenCount ?? 0,
        },
      }
    },
  }
}
