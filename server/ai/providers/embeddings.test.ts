import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { embed, getEmbeddingsConfig, getEmbeddingsServer, DEFAULT_EMBEDDING_DIMENSIONS } from './embeddings.js'
import * as db from '../../db.js'

vi.mock('../../db.js', () => ({
  getSetting: vi.fn(),
}))

function withSettings(values: Record<string, string>) {
  vi.mocked(db.getSetting).mockImplementation((key: string) => values[key])
}

function stubEmbeddingsServer(rows: unknown[], status = 200) {
  const fetchMock = vi.fn(async () => new Response(
    status === 200 ? JSON.stringify({ data: rows }) : 'model not loaded',
    { status, headers: { 'content-type': status === 200 ? 'application/json' : 'text/plain' } },
  ))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.VLLM_BASE_URL = ''
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getEmbeddingsServer', () => {
  it('falls back to the OpenAI-compatible provider URL and key', () => {
    withSettings({ 'vllm.base_url': 'http://llama-swap:8090/v1', 'api_key.vllm': 'chat-key' })
    expect(getEmbeddingsServer()).toEqual({ baseUrl: 'http://llama-swap:8090', apiKey: 'chat-key' })
  })

  it('prefers its own URL and key, normalising a /v1 suffix', () => {
    withSettings({
      'vllm.base_url': 'http://llama-swap:8090',
      'api_key.vllm': 'chat-key',
      'embeddings.base_url': 'http://tei:8080/v1/',
      'api_key.embeddings': 'embed-key',
    })
    expect(getEmbeddingsServer()).toEqual({ baseUrl: 'http://tei:8080', apiKey: 'embed-key' })
  })
})

describe('getEmbeddingsConfig', () => {
  it('is null while no model is selected', () => {
    withSettings({ 'vllm.base_url': 'http://llama-swap:8090', 'embeddings.model': '  ' })
    expect(getEmbeddingsConfig()).toBeNull()
  })

  it('defaults the dimensions when unset or invalid', () => {
    withSettings({ 'embeddings.model': 'bge-m3', 'embeddings.dimensions': 'abc' })
    expect(getEmbeddingsConfig()?.dimensions).toBe(DEFAULT_EMBEDDING_DIMENSIONS)
  })

  it('reads model and dimensions', () => {
    withSettings({ 'vllm.base_url': 'http://llama-swap:8090', 'embeddings.model': 'bge-m3', 'embeddings.dimensions': '768' })
    expect(getEmbeddingsConfig()).toEqual({ baseUrl: 'http://llama-swap:8090', apiKey: '', model: 'bge-m3', dimensions: 768 })
  })
})

describe('embed', () => {
  const config = { baseUrl: 'http://llama-swap:8090', apiKey: 'key', model: 'bge-m3', dimensions: 3 }

  it('posts the texts to /v1/embeddings with the model and key', async () => {
    const fetchMock = stubEmbeddingsServer([{ index: 0, embedding: [0.1, 0.2, 0.3] }])
    await embed(['hello'], config)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://llama-swap:8090/v1/embeddings')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer key')
    expect(JSON.parse(init.body as string)).toEqual({ model: 'bge-m3', input: ['hello'] })
  })

  it('returns vectors in input order, following the index of each row', async () => {
    stubEmbeddingsServer([{ index: 1, embedding: [2, 2, 2] }, { index: 0, embedding: [1, 1, 1] }])
    expect(await embed(['a', 'b'], config)).toEqual([[1, 1, 1], [2, 2, 2]])
  })

  it('sends no Authorization header without a key', async () => {
    const fetchMock = stubEmbeddingsServer([{ index: 0, embedding: [1, 2, 3] }])
    await embed(['a'], { ...config, apiKey: '' })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined()
  })

  it('makes no request for an empty list', async () => {
    const fetchMock = stubEmbeddingsServer([])
    expect(await embed([], config)).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports the HTTP status and body of a failed request', async () => {
    stubEmbeddingsServer([], 503)
    await expect(embed(['a'], config)).rejects.toThrow('HTTP 503: model not loaded')
  })

  it('rejects a response with fewer vectors than texts', async () => {
    stubEmbeddingsServer([{ index: 0, embedding: [1, 2, 3] }])
    await expect(embed(['a', 'b'], config)).rejects.toThrow('1 vectors for 2 texts')
  })

  it('rejects a row without a numeric vector', async () => {
    stubEmbeddingsServer([{ index: 0, embedding: 'AAAA' }])
    await expect(embed(['a'], config)).rejects.toThrow('no numeric vector')
  })

  it('refuses to run without a model', async () => {
    withSettings({})
    await expect(embed(['a'])).rejects.toThrow('EMBEDDINGS_NOT_CONFIGURED')
  })
})
