import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DEFAULT_CONFIG } from './config.js'
import { QUESTIONS, READINGS, recordKey, type BenchRecord } from './types.js'

const { decide } = vi.hoisted(() => ({ decide: vi.fn() }))

vi.mock('../../db/articles.js', () => ({
  getArticleById: (id: number) => ({ id, title: `Title ${id}`, feed_name: 'feed', full_text: 'body', excerpt: null, summary: null }),
}))
vi.mock('../../ai/providers/llm/vllm.js', () => ({ getVllmApiKey: () => '' }))
vi.mock('../../intelligence/journal-db.js', () => ({ getReaderContext: () => ({ liked: [], disliked: [] }) }))
vi.mock('../../ai/classify.js', () => ({
  buildClassifyState: () => 'state',
  buildImportanceQuestion: () => 'How important?',
  createClassifyClient: () => ({ decide, body: vi.fn(), baseUrl: 'http://vllm', path: '/v1/chat/completions' }),
  getClassificationSettings: () => ({ formatTheta: 0.5, themeTheta: 0.3, themes: [{ id: 'AI', label: 'AI', description: 'ai' }] }),
  resolveModel: () => 'model',
  toOptions: (list: Array<{ id: string; description: string }>) => list.map(o => ({ id: o.id, description: o.description })),
  FORMAT_QUESTION: 'Format?',
  THEME_QUESTION: 'Theme?',
}))

import { BenchRunner, loadResults } from './calls.js'

let dir: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notjev-calls-'))
  decide.mockReset()
  decide.mockImplementation(async (q: { options: Array<{ id: string }> }) => ({
    request: { options: q.options.map(o => o.id) }, raw: {}, choice: q.options[0].id, top: q.options[0].id,
    p1: 0.9, p2: 0.05, margin: 0.85, band: 'certain', coverage: 1, degraded: false, undecided: false,
    letters: ['A', 'B', 'C'], probabilities: [0.9, 0.05, 0.05], ms: 600,
  }))
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('the reasoned reference must not be called again') }))
})
afterEach(() => {
  vi.unstubAllGlobals()
  fs.rmSync(dir, { recursive: true, force: true })
})

/** The 9 records of a run made before rotations existed */
function previousRun(articleId: number): string {
  const file = path.join(dir, 'results.jsonl')
  const lines = QUESTIONS.flatMap(q => READINGS.map(reading => JSON.stringify({
    key: recordKey(articleId, reading, q), articleId, reading, question: q,
    questionText: q === 'importance' ? 'Stored importance question' : q, options: [], request: {}, ms: 1, at: '',
    choice: 'X', top: 'X', status: 'ok',
  })))
  fs.writeFileSync(file, lines.join('\n') + '\n')
  return file
}

describe('BenchRunner resume', () => {
  it('only makes the 2 rotation calls on an article whose 9 calls are recorded', async () => {
    const file = previousRun(5)
    const results = loadResults(file)
    const runner = new BenchRunner({ ...DEFAULT_CONFIG, rotations: true }, results, file, () => {})
    await runner.runArticle(5)

    expect(decide).toHaveBeenCalledTimes(2)
    expect(decide.mock.calls.map(c => c[0].options.map((o: { id: string }) => o.id))).toEqual([
      ['USEFUL', 'SKIP', 'ESSENTIAL'],
      ['SKIP', 'ESSENTIAL', 'USEFUL'],
    ])
    // Same question text as the recorded production importance question
    expect(decide.mock.calls.every(c => c[0].question === 'Stored importance question')).toBe(true)
    const after = loadResults(file)
    expect(after.size).toBe(11)
    expect((after.get(recordKey(5, 'rotation1', 'importance')) as BenchRecord).reading).toBe('rotation1')

    // A second resume makes no call at all
    decide.mockClear()
    await new BenchRunner({ ...DEFAULT_CONFIG, rotations: true }, after, file, () => {}).runArticle(5)
    expect(decide).not.toHaveBeenCalled()
  })

  it('makes no rotation call when rotations are off', async () => {
    const file = previousRun(6)
    await new BenchRunner({ ...DEFAULT_CONFIG, rotations: false }, loadResults(file), file, () => {}).runArticle(6)
    expect(decide).not.toHaveBeenCalled()
  })
})
