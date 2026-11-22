import { getSetting } from '../../db.js'
import { getVllmApiKey, getVllmBaseUrl, normalizeOpenAiBaseUrl } from './llm/vllm.js'

/** Vector size of BAAI/bge-m3, the model this feature was set up with */
export const DEFAULT_EMBEDDING_DIMENSIONS = 1024
export const MAX_EMBEDDING_DIMENSIONS = 8192

const EMBED_TIMEOUT_MS = 30_000

export interface EmbeddingsServer {
  /** Server root, without `/v1` */
  baseUrl: string
  apiKey: string
}

export interface EmbeddingsConfig extends EmbeddingsServer {
  model: string
  dimensions: number
}

/**
 * The server embeddings are asked from. Each field falls back to the
 * OpenAI-compatible provider, so a single llama-swap serving both the chat
 * model and the embedding model needs no second URL or key.
 */
export function getEmbeddingsServer(): EmbeddingsServer {
  const ownUrl = getSetting('embeddings.base_url')
  return {
    baseUrl: ownUrl ? normalizeOpenAiBaseUrl(ownUrl) : getVllmBaseUrl(),
    apiKey: getSetting('api_key.embeddings') || getVllmApiKey(),
  }
}

/** The full configuration, or null while no model is selected: embeddings are off until then */
export function getEmbeddingsConfig(): EmbeddingsConfig | null {
  const model = getSetting('embeddings.model')?.trim()
  if (!model) return null
  const dimensions = Number(getSetting('embeddings.dimensions'))
  return {
    ...getEmbeddingsServer(),
    model,
    dimensions: Number.isInteger(dimensions) && dimensions > 0 ? dimensions : DEFAULT_EMBEDDING_DIMENSIONS,
  }
}

/** GET a path of the embeddings server (e.g. `/v1/models`) with its key */
export function fetchEmbeddingsServer(path: string, timeoutMs = 5_000): Promise<Response> {
  const { baseUrl, apiKey } = getEmbeddingsServer()
  return fetch(`${baseUrl}${path}`, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    signal: AbortSignal.timeout(timeoutMs),
  })
}

/**
 * One vector per input text, in input order, from the OpenAI-compatible
 * `/v1/embeddings` endpoint. The vector size is not checked here: callers
 * compare it with `config.dimensions` where a mismatch matters.
 */
export async function embed(texts: string[], config: EmbeddingsConfig | null = getEmbeddingsConfig()): Promise<number[][]> {
  if (!config) throw new Error('EMBEDDINGS_NOT_CONFIGURED')
  if (texts.length === 0) return []
  const res = await fetch(`${config.baseUrl}/v1/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify({ model: config.model, input: texts }),
    signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
  })
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 200)
    throw new Error(`Embeddings server answered HTTP ${res.status}${detail ? `: ${detail}` : ''}`)
  }
  const body = await res.json() as { data?: Array<{ index?: number; embedding?: unknown }> }
  const rows = body.data ?? []
  if (rows.length !== texts.length) {
    throw new Error(`Embeddings server returned ${rows.length} vectors for ${texts.length} texts`)
  }
  // The OpenAI format carries an index per row; order by it when present
  const ordered = rows.every(r => typeof r.index === 'number')
    ? [...rows].sort((a, b) => (a.index as number) - (b.index as number))
    : rows
  return ordered.map((r, i) => {
    if (!Array.isArray(r.embedding) || !r.embedding.every(v => typeof v === 'number')) {
      throw new Error(`Embeddings server returned no numeric vector for text ${i}`)
    }
    return r.embedding as number[]
  })
}
