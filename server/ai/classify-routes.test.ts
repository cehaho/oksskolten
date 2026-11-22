import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupTestDb } from '../__tests__/helpers/testDb.js'
import { buildApp } from '../__tests__/helpers/buildApp.js'
import { createFeed, insertArticle } from '../db.js'
import { getDb } from '../db/connection.js'
import { _resetAiQueueForTests } from './queue.js'
import { syncHiddenThemes } from './classify.js'
import type { FastifyInstance } from 'fastify'

let app: FastifyInstance
const json = { 'content-type': 'application/json' }

/**
 * Fake OpenAI-compatible server: answers every closed question with `letter`
 * as the top token (logprobs on), which notjev maps back to an option.
 */
function stubLogprobServer(letter: string, p = 0.95) {
  const fetchMock = vi.fn(async () => {
    const other = letter === 'A' ? 'B' : 'A'
    const top = [
      { token: letter, logprob: Math.log(p) },
      { token: other, logprob: Math.log(1 - p) },
    ]
    return new Response(JSON.stringify({
      model: 'test-model',
      choices: [{ message: { content: letter }, logprobs: { content: [{ token: letter, logprob: top[0].logprob, top_logprobs: top }] } }],
      usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 },
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

async function flushQueue() {
  for (let i = 0; i < 20; i++) await new Promise(resolve => setTimeout(resolve, 0))
}

async function enable(extra: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: 'PATCH', url: '/api/classification/settings', headers: json,
    payload: { enabled: true, model: 'test-model', ...extra },
  })
  expect(res.statusCode).toBe(200)
  return res.json()
}

beforeEach(async () => {
  setupTestDb()
  _resetAiQueueForTests()
  app = await buildApp()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('classification API', () => {
  it('starts disabled with the default formats and themes', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/classification' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.enabled).toBe(false)
    expect(body.hideCategories).toBe(false)
    expect(body.formats.map((f: { id: string }) => f.id)).toContain('QUESTION')
    expect(body.themes.map((t: { id: string }) => t.id)).toContain('AI')
    expect(body.formats.every((f: { unread_count: number }) => f.unread_count === 0)).toBe(true)
  })

  it('saves settings and normalizes theme ids', async () => {
    const saved = await enable({
      formatTheta: 0.4,
      themes: [{ label: 'Home automation', description: 'smart home' }, { id: 'other', label: 'Other' }],
    })
    expect(saved.enabled).toBe(true)
    expect(saved.formatTheta).toBe(0.4)
    expect(saved.themes.map((t: { id: string }) => t.id)).toEqual(['HOME_AUTOMATION', 'OTHER'])
  })

  it('hides categories by default once enabled, unless turned off', async () => {
    await enable()
    expect((await app.inject({ method: 'GET', url: '/api/classification' })).json().hideCategories).toBe(true)
    const saved = await enable({ hideCategories: false })
    expect(saved.hideCategories).toBe(false)
    expect((await app.inject({ method: 'GET', url: '/api/classification' })).json().hideCategories).toBe(false)
  })

  it('refuses duplicate theme ids and out-of-range thresholds', async () => {
    const dup = await app.inject({
      method: 'PATCH', url: '/api/classification/settings', headers: json,
      payload: { themes: [{ id: 'ai', label: 'AI' }, { id: 'AI', label: 'Also AI' }] },
    })
    expect(dup.statusCode).toBe(400)
    const theta = await app.inject({
      method: 'PATCH', url: '/api/classification/settings', headers: json,
      payload: { themeTheta: 2 },
    })
    expect(theta.statusCode).toBe(400)
  })

  it('runs a live test classification without storing anything', async () => {
    await enable()
    const fetchMock = stubLogprobServer('B')
    const res = await app.inject({
      method: 'POST', url: '/api/classification/test', headers: json,
      payload: { title: 'Which GPU should I buy for local models?' },
    })
    expect(res.json()).toMatchObject({ ok: true, result: { format: 'QUESTION', theme: 'COMICS', importance: 'USEFUL', model: 'test-model' } })
    // One request per question (format, theme, importance), sent to the vLLM endpoint with the configured model
    expect(fetchMock).toHaveBeenCalledTimes(3)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }]
    expect(url).toMatch(/\/v1\/chat\/completions$/)
    expect(JSON.parse(init.body)).toMatchObject({ model: 'test-model', max_tokens: 1, logprobs: true })
  })

  it('sends classification to a server URL entered with /v1 without doubling it', async () => {
    await enable()
    const prefs = await app.inject({
      method: 'PATCH', url: '/api/settings/preferences', headers: json,
      payload: { 'vllm.base_url': 'http://llama-swap:8090/v1' },
    })
    expect(prefs.statusCode).toBe(200)
    const fetchMock = stubLogprobServer('B')
    await app.inject({ method: 'POST', url: '/api/classification/test', headers: json, payload: { title: 'A new album' } })
    const [url] = fetchMock.mock.calls[0] as unknown as [string]
    expect(url).toBe('http://llama-swap:8090/v1/chat/completions')
  })

  it('asks the importance question with the reader instruction for the theme found', async () => {
    await enable()
    await app.inject({ method: 'PUT', url: '/api/journal/instructions/COMICS', headers: json, payload: { instruction: 'Skip reprint announcements' } })
    // 'B' everywhere: theme B is COMICS, importance B is USEFUL
    const fetchMock = stubLogprobServer('B')
    await app.inject({ method: 'POST', url: '/api/classification/test', headers: json, payload: { title: 'A new album' } })
    const [, init] = fetchMock.mock.calls[2] as unknown as [string, { body: string }]
    expect(init.body).toContain('Skip reprint announcements')
  })

  it('reports a server failure from the test endpoint instead of throwing', async () => {
    await enable()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    const res = await app.inject({
      method: 'POST', url: '/api/classification/test', headers: json,
      payload: { title: 'Anything' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().ok).toBe(false)
  })

  it('backfills unclassified articles, then filters lists and counts by class', async () => {
    const feed = createFeed({ name: 'r/LocalLLM', url: 'https://r.example.com' })
    const now = new Date().toISOString()
    const a = insertArticle({ feed_id: feed.id, title: 'Help with my rig', url: 'https://r.example.com/1', published_at: now })
    insertArticle({ feed_id: feed.id, title: 'Another one', url: 'https://r.example.com/2', published_at: now })

    const disabled = await app.inject({ method: 'POST', url: '/api/classification/backfill', headers: json, payload: {} })
    expect(disabled.statusCode).toBe(409)

    await enable()
    stubLogprobServer('B')
    const res = await app.inject({ method: 'POST', url: '/api/classification/backfill', headers: json, payload: {} })
    expect(res.json()).toEqual({ queued: 2 })
    await flushQueue()

    const row = getDb().prepare('SELECT format, theme, classified_at FROM articles WHERE id = ?').get(a) as Record<string, string | null>
    expect(row).toMatchObject({ format: 'QUESTION', theme: 'COMICS' })
    expect(row.classified_at).toBeTruthy()

    const overview = (await app.inject({ method: 'GET', url: '/api/classification' })).json()
    expect(overview.unclassified).toBe(0)
    expect(overview.formats.find((f: { id: string }) => f.id === 'QUESTION').unread_count).toBe(2)

    const list = await app.inject({ method: 'GET', url: '/api/articles?format=question&no_floor=1' })
    expect(list.json().articles).toHaveLength(2)
    const none = await app.inject({ method: 'GET', url: '/api/articles?theme=AI&no_floor=1' })
    expect(none.json().articles).toHaveLength(0)

    // Nothing left to classify, unless every verdict is forgotten first
    expect((await app.inject({ method: 'POST', url: '/api/classification/backfill', headers: json, payload: {} })).json()).toEqual({ queued: 0 })
    expect((await app.inject({ method: 'POST', url: '/api/classification/backfill', headers: json, payload: { all: true } })).json()).toEqual({ queued: 2 })
    await flushQueue()
  })

  it('filters smart folders with format: and theme:', async () => {
    const feed = createFeed({ name: 'News', url: 'https://n.example.com' })
    const now = new Date().toISOString()
    const a = insertArticle({ feed_id: feed.id, title: 'A', url: 'https://n.example.com/a', published_at: now })
    insertArticle({ feed_id: feed.id, title: 'B', url: 'https://n.example.com/b', published_at: now })
    getDb().prepare("UPDATE articles SET format = 'NEWS', theme = 'AUTO' WHERE id = ?").run(a)

    const created = await app.inject({ method: 'POST', url: '/api/smart-folders', headers: json, payload: { name: 'Auto news', query: 'format:news theme:auto' } })
    expect(created.statusCode).toBeLessThan(300)
    const folders = (await app.inject({ method: 'GET', url: '/api/smart-folders' })).json().folders
    expect(folders[0].unread_count).toBe(1)
  })

  describe('hidden themes', () => {
    const themes = [
      { id: 'LINUX', label: 'Linux', description: 'kernel' },
      { id: 'SPORT', label: 'Sport', description: 'football' },
      { id: 'OTHER', label: 'Other', description: 'none of the above' },
    ]
    const filtered = (id: number) => {
      // Pick the columns: libsql rows also carry a _metadata field
      const row = getDb().prepare('SELECT filtered_at, hidden_by_theme FROM articles WHERE id = ?').get(id) as { filtered_at: string | null; hidden_by_theme: string | null }
      return { filtered_at: row.filtered_at, hidden_by_theme: row.hidden_by_theme }
    }

    function seed() {
      const feed = createFeed({ name: 'Mix', url: 'https://mix.example.com' })
      const now = new Date().toISOString()
      const linux = insertArticle({ feed_id: feed.id, title: 'Kernel', url: 'https://mix.example.com/1', published_at: now })
      const sport = insertArticle({ feed_id: feed.id, title: 'Match', url: 'https://mix.example.com/2', published_at: now })
      const ruled = insertArticle({ feed_id: feed.id, title: 'Promo', url: 'https://mix.example.com/3', published_at: now })
      getDb().prepare("UPDATE articles SET theme = 'LINUX' WHERE id = ?").run(linux)
      getDb().prepare("UPDATE articles SET theme = 'SPORT' WHERE id IN (?, ?)").run(sport, ruled)
      // Hidden by a rule before the theme was: must stay hidden after un-hiding
      getDb().prepare("UPDATE articles SET filtered_at = '2026-01-01T00:00:00Z' WHERE id = ?").run(ruled)
      return { linux, sport, ruled }
    }

    it('hides the articles of a hidden theme and the theme itself, reversibly', async () => {
      const { linux, sport, ruled } = seed()
      const saved = await enable({ themes: themes.map(th => th.id === 'SPORT' ? { ...th, hidden: true } : th) })
      expect(saved.themes.find((th: { id: string }) => th.id === 'SPORT').hidden).toBe(true)
      expect(saved.themes.find((th: { id: string }) => th.id === 'LINUX').hidden).toBeUndefined()

      expect(filtered(sport)).toMatchObject({ hidden_by_theme: 'SPORT' })
      expect(filtered(sport).filtered_at).not.toBeNull()
      expect(filtered(linux)).toEqual({ filtered_at: null, hidden_by_theme: null })
      expect(filtered(ruled)).toEqual({ filtered_at: '2026-01-01T00:00:00Z', hidden_by_theme: null })

      const overview = (await app.inject({ method: 'GET', url: '/api/classification' })).json()
      expect(overview.themes.map((th: { id: string }) => th.id)).toEqual(['LINUX', 'OTHER'])

      await enable({ themes })
      expect(filtered(sport)).toEqual({ filtered_at: null, hidden_by_theme: null })
      expect(filtered(ruled)).toEqual({ filtered_at: '2026-01-01T00:00:00Z', hidden_by_theme: null })
    })

    it('brings articles back when their hidden theme is removed', async () => {
      const { sport } = seed()
      await enable({ themes: themes.map(th => th.id === 'SPORT' ? { ...th, hidden: true } : th) })
      await enable({ themes: themes.filter(th => th.id !== 'SPORT') })
      expect(filtered(sport)).toEqual({ filtered_at: null, hidden_by_theme: null })
    })

    it('hides a newly classified article and un-hides it on reclassification', async () => {
      const { linux } = seed()
      await enable({ themes: themes.map(th => th.id === 'LINUX' ? { ...th, hidden: true } : th) })
      expect(filtered(linux).hidden_by_theme).toBe('LINUX')

      getDb().prepare("UPDATE articles SET theme = 'SPORT' WHERE id = ?").run(linux)
      syncHiddenThemes(linux)
      expect(filtered(linux)).toEqual({ filtered_at: null, hidden_by_theme: null })

      getDb().prepare("UPDATE articles SET theme = 'LINUX' WHERE id = ?").run(linux)
      syncHiddenThemes(linux)
      expect(filtered(linux).hidden_by_theme).toBe('LINUX')

      stubLogprobServer('B')
      await app.inject({ method: 'POST', url: '/api/classification/backfill', headers: json, payload: { all: true } })
      expect(filtered(linux).hidden_by_theme).toBeNull()
    })
  })
})
