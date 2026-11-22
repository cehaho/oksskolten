import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getSetting, upsertSetting, deleteSetting } from '../db.js'
import { requireJson } from '../auth/index.js'
import { getMonthlyUsage } from './providers/translate/google-translate.js'
import { getDeeplMonthlyUsage } from './providers/translate/deepl.js'
import { embed, fetchEmbeddingsServer, getEmbeddingsConfig } from './providers/embeddings.js'

const ProviderParams = z.object({ provider: z.string() })
const ApiKeyBody = z.object({ apiKey: z.string().optional() })

export async function aiSettingsRoutes(api: FastifyInstance): Promise<void> {
  // --- Provider API key management ---

  const PROVIDER_KEY_MAP: Record<string, string> = {
    anthropic: 'api_key.anthropic',
    gemini: 'api_key.gemini',
    openai: 'api_key.openai',
    vllm: 'api_key.vllm',
    embeddings: 'api_key.embeddings',
    'google-translate': 'api_key.google_translate',
    deepl: 'api_key.deepl',
    github: 'github.token',
    discord: 'discord.bot_token',
    forgejo: 'git_backup.forgejo_token',
  }

  api.get('/api/settings/api-keys/:provider', async (request, reply) => {
    const { provider } = ProviderParams.parse(request.params)
    const settingKey = PROVIDER_KEY_MAP[provider]
    if (!settingKey) {
      reply.status(400).send({ error: `Unknown provider: ${provider}` })
      return
    }
    reply.send({ configured: !!getSetting(settingKey) })
  })

  api.post('/api/settings/api-keys/:provider', { preHandler: [requireJson] }, async (request, reply) => {
    const { provider } = ProviderParams.parse(request.params)
    const settingKey = PROVIDER_KEY_MAP[provider]
    if (!settingKey) {
      reply.status(400).send({ error: `Unknown provider: ${provider}` })
      return
    }
    const { apiKey } = ApiKeyBody.parse(request.body)
    if (!apiKey || apiKey.trim() === '') {
      deleteSetting(settingKey)
      reply.send({ ok: true, configured: false })
    } else {
      upsertSetting(settingKey, apiKey.trim())
      reply.send({ ok: true, configured: true })
    }
  })

  // --- Translation provider usage ---

  api.get('/api/settings/google-translate/usage', async (_request, reply) => {
    reply.send(getMonthlyUsage())
  })

  api.get('/api/settings/deepl/usage', async (_request, reply) => {
    reply.send(getDeeplMonthlyUsage())
  })

  // --- Ollama endpoints ---

  async function ollamaFetch(path: string): Promise<Response> {
    const { getOllamaBaseUrl, getOllamaCustomHeaders } = await import('./providers/llm/ollama.js')
    const baseUrl = getOllamaBaseUrl().replace(/\/+$/, '')
    const headers = getOllamaCustomHeaders()
    return fetch(`${baseUrl}${path}`, { headers, signal: AbortSignal.timeout(5_000) })
  }

  api.get('/api/settings/ollama/models', async (_request, reply) => {
    try {
      const res = await ollamaFetch('/api/tags')
      if (!res.ok) {
        reply.send({ models: [] })
        return
      }
      const data = await res.json() as { models?: Array<{ name: string; size: number; details?: { parameter_size?: string } }> }
      const models = (data.models || []).map(m => ({
        name: m.name,
        size: m.size,
        parameter_size: m.details?.parameter_size || '',
      }))
      reply.send({ models })
    } catch {
      reply.send({ models: [] })
    }
  })

  api.get('/api/settings/ollama/status', async (_request, reply) => {
    try {
      const [versionRes, tagsRes] = await Promise.all([
        ollamaFetch('/api/version'),
        ollamaFetch('/api/tags'),
      ])
      if (!versionRes.ok || !tagsRes.ok) {
        reply.send({ ok: false, error: `HTTP ${versionRes.status}` })
        return
      }
      const versionData = await versionRes.json() as { version?: string }
      const tagsData = await tagsRes.json() as { models?: unknown[] }
      reply.send({
        ok: true,
        version: versionData.version || 'unknown',
        model_count: tagsData.models?.length || 0,
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Connection failed'
      reply.send({ ok: false, error: message })
    }
  })

  // --- vLLM endpoints ---

  async function vllmFetch(path: string): Promise<Response> {
    const { getVllmBaseUrl, getVllmApiKey } = await import('./providers/llm/vllm.js')
    const baseUrl = getVllmBaseUrl()
    const apiKey = getVllmApiKey()
    const headers: Record<string, string> = {}
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`
    return fetch(`${baseUrl}${path}`, { headers, signal: AbortSignal.timeout(5_000) })
  }

  api.get('/api/settings/vllm/models', async (_request, reply) => {
    try {
      const res = await vllmFetch('/v1/models')
      if (!res.ok) {
        reply.send({ models: [] })
        return
      }
      const data = await res.json() as { data?: Array<{ id: string }> }
      const models = (data.data || []).map(m => ({
        name: m.id,
      }))
      reply.send({ models })
    } catch {
      reply.send({ models: [] })
    }
  })

  api.get('/api/settings/vllm/status', async (_request, reply) => {
    try {
      const res = await vllmFetch('/v1/models')
      if (!res.ok) {
        reply.send({ ok: false, error: `HTTP ${res.status}` })
        return
      }
      const data = await res.json() as { data?: unknown[] }
      reply.send({
        ok: true,
        model_count: data.data?.length || 0,
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Connection failed'
      reply.send({ ok: false, error: message })
    }
  })

  // --- Embeddings endpoints ---

  api.get('/api/settings/embeddings/models', async (_request, reply) => {
    try {
      const res = await fetchEmbeddingsServer('/v1/models')
      if (!res.ok) {
        reply.send({ models: [] })
        return
      }
      const data = await res.json() as { data?: Array<{ id: string }> }
      reply.send({ models: (data.data || []).map(m => ({ name: m.id })) })
    } catch {
      reply.send({ models: [] })
    }
  })

  /** Embed one short text with the saved settings: reachability, vector size and latency */
  api.get('/api/settings/embeddings/status', async (_request, reply) => {
    const config = getEmbeddingsConfig()
    if (!config) {
      reply.send({ ok: false, error: 'EMBEDDINGS_NOT_CONFIGURED' })
      return
    }
    const started = Date.now()
    try {
      const [vector] = await embed(['Oksskolten embedding connection test'], config)
      reply.send({ ok: true, dimensions: vector.length, expected: config.dimensions, ms: Date.now() - started })
    } catch (err: unknown) {
      reply.send({ ok: false, error: err instanceof Error ? err.message : 'Connection failed' })
    }
  })
}
