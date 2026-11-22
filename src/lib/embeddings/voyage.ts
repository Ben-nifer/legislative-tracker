// Voyage AI embeddings client (recommendations-plan.md §5, D6).
// Plain fetch, no SDK: one endpoint, and retry/backoff is all we need.

// The active model. The HNSW index in 020 is partial on this name, so a change
// here needs a new index plus a re-embed (content_embeddings is keyed by model).
export const EMBEDDING_MODEL = 'voyage-3.5'
export const EMBEDDING_DIMENSIONS = 1024

// Well under voyage-3.5's per-request limits (1,000 inputs / 320K tokens)
export const EMBED_BATCH_SIZE = 128

const ENDPOINT = 'https://api.voyageai.com/v1/embeddings'
const MAX_ATTEMPTS = 4

export type InputType = 'document' | 'query'

interface VoyageResponse {
  data: { index: number; embedding: number[] }[]
  usage: { total_tokens: number }
}

export interface EmbedResult {
  embeddings: number[][]
  tokens: number
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function isRetryable(status: number) {
  return status === 429 || status >= 500
}

// Embeds texts in input order. Over-long inputs are truncated by Voyage
// (truncation defaults to true), so callers don't need to count tokens.
export async function embed(
  texts: string[],
  inputType: InputType,
  options: { fetchImpl?: typeof fetch; baseDelayMs?: number } = {}
): Promise<EmbedResult> {
  const apiKey = process.env.VOYAGE_API_KEY
  if (!apiKey) throw new Error('VOYAGE_API_KEY not set')
  if (texts.length === 0) return { embeddings: [], tokens: 0 }

  const fetchImpl = options.fetchImpl ?? fetch
  const baseDelayMs = options.baseDelayMs ?? 1000

  for (let attempt = 1; ; attempt++) {
    let response: Response
    try {
      response = await fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: texts, model: EMBEDDING_MODEL, input_type: inputType }),
      })
    } catch (error) {
      // Network failure: retry like a 5xx
      if (attempt >= MAX_ATTEMPTS) throw error
      await sleep(baseDelayMs * 2 ** (attempt - 1))
      continue
    }

    if (response.ok) {
      const body = (await response.json()) as VoyageResponse
      const embeddings = new Array<number[]>(texts.length)
      for (const d of body.data) embeddings[d.index] = d.embedding
      if (embeddings.some((e) => e?.length !== EMBEDDING_DIMENSIONS)) {
        throw new Error(`Voyage returned a vector that isn't ${EMBEDDING_DIMENSIONS}-d`)
      }
      return { embeddings, tokens: body.usage.total_tokens }
    }

    if (!isRetryable(response.status) || attempt >= MAX_ATTEMPTS) {
      const detail = await response.text().catch(() => '')
      throw new Error(`Voyage ${response.status}: ${detail.slice(0, 300)}`)
    }
    await sleep(baseDelayMs * 2 ** (attempt - 1))
  }
}

// pgvector's text format, which PostgREST passes straight into a vector column
export function toPgVector(embedding: number[]): string {
  return `[${embedding.join(',')}]`
}
