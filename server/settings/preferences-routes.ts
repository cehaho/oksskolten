import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { getSetting, upsertSetting, deleteSetting } from '../db.js'
import { requireJson } from '../auth/index.js'
import { PREF_KEYS, PREF_ALLOWED, PROVIDER_MODEL_PAIRS, validateProviderModel } from './preferences.js'
import { MAX_EMBEDDING_DIMENSIONS } from '../ai/providers/embeddings.js'

export async function preferencesRoutes(api: FastifyInstance): Promise<void> {
  // --- Preferences endpoints ---

  api.get('/api/settings/preferences', async (_request, reply) => {
    const result: Record<string, string | null> = {}
    for (const key of PREF_KEYS) {
      result[key] = getSetting(key) ?? null
    }
    reply.send(result)
  })

  const handlePrefsUpdate = async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as Record<string, unknown> // dynamic keys, validated per-field below

    // Validate provider-model consistency before saving
    const validationError = validateProviderModel(body)
    if (validationError) {
      reply.status(400).send({ error: validationError })
      return
    }

    let updated = false
    for (const key of PREF_KEYS) {
      if (body[key] === undefined) continue
      const value = String(body[key])
      if (value === '') {
        deleteSetting(key)
        updated = true
        continue
      }
      // Custom validation for keybindings JSON
      if (key === 'reading.keybindings') {
        try {
          const parsed = JSON.parse(value)
          const validKeys = new Set(['next', 'prev', 'bookmark', 'openExternal'])
          const keys = Object.keys(parsed)
          if (keys.length !== 4 || !keys.every(k => validKeys.has(k))) {
            reply.status(400).send({ error: 'Invalid keybindings: keys must be next, prev, bookmark, openExternal' })
            return
          }
          const PRINTABLE_RE = /^[!-~]$/
          const vals = Object.values(parsed) as string[]
          if (!vals.every(v => typeof v === 'string' && PRINTABLE_RE.test(v))) {
            reply.status(400).send({ error: 'Invalid keybindings: values must be single printable ASCII characters' })
            return
          }
          if (new Set(vals).size !== vals.length) {
            reply.status(400).send({ error: 'Invalid keybindings: duplicate key assignments are not allowed' })
            return
          }
        } catch {
          reply.status(400).send({ error: 'Invalid keybindings: must be valid JSON' })
          return
        }
        upsertSetting(key, value)
        updated = true
        continue
      }
      const allowed = PREF_ALLOWED[key]
      if (allowed && !allowed.includes(value)) {
        // Skip static model list check when provider is ollama or vllm (dynamic models)
        const modelKeyPair = PROVIDER_MODEL_PAIRS.find(p => p.modelKey === key)
        if (modelKeyPair) {
          const provider = body[modelKeyPair.providerKey] !== undefined
            ? String(body[modelKeyPair.providerKey])
            : getSetting(modelKeyPair.providerKey)
          if (provider === 'ollama' || provider === 'vllm') {
            upsertSetting(key, value)
            updated = true
            continue
          }
        }

        reply.status(400).send({ error: `Invalid value for ${key}` })
        return
      }
      // Validate retention days: must be a positive integer
      if (key === 'retention.read_days' || key === 'retention.unread_days') {
        const parsed = z.coerce.number().int().min(1).max(9999).safeParse(value)
        if (!parsed.success) {
          reply.status(400).send({ error: `${key} must be a positive integer (1-9999)` })
          return
        }
      }
      if (key === 'reading.auto_translate_concurrency') {
        const parsed = z.coerce.number().int().min(1).max(5).safeParse(value)
        if (!parsed.success) {
          reply.status(400).send({ error: `${key} must be an integer between 1 and 5` })
          return
        }
      }
      if (key === 'embeddings.dimensions') {
        const parsed = z.coerce.number().int().min(1).max(MAX_EMBEDDING_DIMENSIONS).safeParse(value)
        if (!parsed.success) {
          reply.status(400).send({ error: `${key} must be an integer between 1 and ${MAX_EMBEDDING_DIMENSIONS}` })
          return
        }
      }
      // Validate AI max tokens: must be a positive integer
      if (key === 'summary.max_tokens' || key === 'translate.max_tokens') {
        const parsed = z.coerce.number().int().min(1).max(200000).safeParse(value)
        if (!parsed.success) {
          reply.status(400).send({ error: `${key} must be a positive integer (1-200000)` })
          return
        }
      }
      upsertSetting(key, value)
      updated = true
    }
    if (!updated) {
      reply.status(400).send({ error: 'No valid fields to update' })
      return
    }
    const result: Record<string, string | null> = {}
    for (const key of PREF_KEYS) {
      result[key] = getSetting(key) ?? null
    }
    reply.send(result)
  }

  api.patch('/api/settings/preferences', { preHandler: [requireJson] }, handlePrefsUpdate)
  api.post('/api/settings/preferences', { preHandler: [requireJson] }, handlePrefsUpdate)
}
