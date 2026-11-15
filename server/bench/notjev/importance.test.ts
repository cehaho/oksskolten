import { describe, it, expect } from 'vitest'
import {
  analyzeLabels,
  applied,
  compareRotations,
  diagnoseRepro,
  extractState,
  labelingSet,
  parseTs,
  rotationReading,
  STRATA,
} from './importance.js'
import { rotate } from './util.js'
import { recordKey, type ArticleMeta, type BenchRecord, type DecideRecord, type ImportanceLabel, type SampleFile } from './types.js'

const IDS = ['ESSENTIAL', 'USEFUL', 'SKIP']

/** A server response whose letters A, B, C carry the given probabilities */
function resp(probs: number[]) {
  const letters = probs.map((_, i) => String.fromCharCode(65 + i))
  const top = letters.map((token, i) => ({ token, logprob: Math.log(probs[i]) }))
  const best = top.slice().sort((a, b) => b.logprob - a.logprob)[0]
  return { choices: [{ message: { content: best.token }, logprobs: { content: [{ token: best.token, logprob: best.logprob, top_logprobs: top }] } }] }
}

/** A recorded readout; `byId` gives each option id's probability, whatever its position */
function rec(articleId: number, reading: DecideRecord['reading'], options: string[], byId: Record<string, number>, extra: Partial<DecideRecord> = {}): DecideRecord {
  const probs = options.map(id => byId[id])
  const sorted = probs.slice().sort((a, b) => b - a)
  const margin = sorted[0] - sorted[1]
  const top = options[probs.indexOf(sorted[0])]
  const choice = margin >= 0.3 ? top : null
  return {
    key: recordKey(articleId, reading, 'importance'), articleId, reading, question: 'importance',
    questionText: 'How important is this article for the reader?', options,
    request: { messages: [{ role: 'user', content: `Choose the correct option. Reply with only its letter.\n\nContext:\nTitle: T${articleId}\nSource: feed\n\nbody text\n\nQuestion: How important?\nA. x` }] },
    ms: 600, at: '2026-11-10T10:00:00.000Z', theta: 0.3, resp: resp(probs), choice, top,
    p1: sorted[0], p2: sorted[1], margin, band: sorted[0] >= 0.9 ? 'certain' : sorted[0] >= 0.7 ? 'high' : 'med',
    coverage: 1, degraded: false, undecided: choice === null, letters: options.map((_, i) => String.fromCharCode(65 + i)), probabilities: probs,
    ...extra,
  }
}

function meta(id: number, stored: Partial<ArticleMeta['stored']> = {}): ArticleMeta {
  return {
    id, title: `Title ${id}`, feed: 'feed', url: `https://example.com/${id}`, excerpt: 'excerpt',
    stored: { format: null, theme: 'AI', importance: null, classifiedAt: '2026-11-01T00:00:00.000Z', ...stored },
    label: null, labelSources: [],
  }
}

function sampleOf(articles: ArticleMeta[]): SampleFile {
  return {
    createdAt: '', seed: 1, trial: false, requested: articles.length, articles,
    settings: { vllmBaseUrl: '', baseUrlSetting: null, classifyModel: null, summaryModel: null, model: 'm', apiKeyPresent: false, formatTheta: 0.5, themeTheta: 0.3, importanceTheta: 0.3, themes: [] },
    counts: { labeledAvailable: 0, labeledUsed: 0, excludedAsInjectedExamples: 0, injectedTitles: 0, complementPool: 0, complementUsed: 0 },
  }
}

/** Production readout whose verdict is `v` (null = undecided) */
function prodFor(id: number, v: string | null): DecideRecord {
  if (v === null) return rec(id, 'production', IDS, { ESSENTIAL: 0.45, USEFUL: 0.4, SKIP: 0.15 })
  return rec(id, 'production', IDS, { ESSENTIAL: 0.05, USEFUL: 0.05, SKIP: 0.05, [v]: 0.9 })
}

describe('small readers', () => {
  it('rotates the option list', () => {
    expect(rotate(IDS, 1)).toEqual(['USEFUL', 'SKIP', 'ESSENTIAL'])
    expect(rotate(IDS, 2)).toEqual(['SKIP', 'ESSENTIAL', 'USEFUL'])
    expect(rotate(IDS, 3)).toEqual(IDS)
  })

  it('reads an undecided importance as USEFUL, as the journal does', () => {
    expect(applied(null)).toBe('USEFUL')
    expect(applied('SKIP')).toBe('SKIP')
  })

  it('extracts the context block exactly as sent', () => {
    expect(extractState(prodFor(1, 'SKIP').request)).toBe('Title: T1\nSource: feed\n\nbody text')
    expect(extractState({})).toBeNull()
  })

  it('parses SQLite and ISO timestamps as UTC', () => {
    expect(parseTs('2026-11-01 10:00:00')).toBe(Date.parse('2026-11-01T10:00:00Z'))
    expect(parseTs('2026-11-01T10:00:00.000Z')).toBe(Date.parse('2026-11-01T10:00:00Z'))
    expect(parseTs(null)).toBeNaN()
  })
})

describe('rotationReading', () => {
  it('averages the three rotations on the option ids, then applies the margin', () => {
    // A position bias towards the first letter: each rotation favours whatever is in A
    const recs = [
      rec(1, 'production', IDS, { ESSENTIAL: 0.6, USEFUL: 0.3, SKIP: 0.1 }),
      rec(1, 'rotation1', rotate(IDS, 1), { USEFUL: 0.6, SKIP: 0.1, ESSENTIAL: 0.3 }),
      rec(1, 'rotation2', rotate(IDS, 2), { SKIP: 0.5, ESSENTIAL: 0.3, USEFUL: 0.2 }),
    ]
    const v = rotationReading(recs, IDS, 0.3)!
    expect(v.byOption.ESSENTIAL).toBeCloseTo(0.4, 2)
    expect(v.byOption.USEFUL).toBeCloseTo(0.3667, 2)
    expect(v.byOption.SKIP).toBeCloseTo(0.2333, 2)
    expect(v.top).toBe('ESSENTIAL')
    expect(v.choice).toBeNull()
    expect(rotationReading(recs, IDS, 0)!.choice).toBe('ESSENTIAL')
  })

  it('keeps a verdict that does not depend on the order', () => {
    const recs = [0, 1, 2].map(k => rec(1, (['production', 'rotation1', 'rotation2'] as const)[k], rotate(IDS, k), { ESSENTIAL: 0.05, USEFUL: 0.05, SKIP: 0.9 }))
    expect(rotationReading(recs, IDS, 0.3)!.choice).toBe('SKIP')
  })
})

describe('labelingSet', () => {
  // 30 ESSENTIAL, 40 USEFUL, 10 SKIP, 20 undecided
  const verdicts: Array<string | null> = [
    ...Array(30).fill('ESSENTIAL'), ...Array(40).fill('USEFUL'), ...Array(10).fill('SKIP'), ...Array(20).fill(null),
  ]
  const articles = verdicts.map((_, i) => meta(i + 1))
  const results = new Map<string, BenchRecord>()
  verdicts.forEach((v, i) => { const r = prodFor(i + 1, v); results.set(r.key, r) })
  const sample = sampleOf(articles)

  it('draws 15 per stratum, completes a short stratum from the others, deterministically', () => {
    const set = labelingSet(sample, results, { seed: 7, size: 60, perStratum: 15 })
    expect(set.items).toHaveLength(60)
    expect(set.strataSizes).toEqual({ ESSENTIAL: 30, USEFUL: 40, SKIP: 10, UNDECIDED: 20 })
    expect(set.drawn.SKIP).toBe(10)
    expect(set.drawn.ESSENTIAL + set.drawn.USEFUL + set.drawn.UNDECIDED).toBe(50)
    expect(Math.min(set.drawn.ESSENTIAL, set.drawn.USEFUL, set.drawn.UNDECIDED)).toBeGreaterThanOrEqual(15)
    expect(labelingSet(sample, results, { seed: 7, size: 60, perStratum: 15 }).items.map(i => i.articleId))
      .toEqual(set.items.map(i => i.articleId))
    expect(new Set(set.items.map(i => i.articleId)).size).toBe(60)
  })

  it('shuffles the strata together and carries the text sent to the model', () => {
    const set = labelingSet(sample, results, { seed: 7, size: 60, perStratum: 15 })
    const strata = set.items.map(i => i.stratum)
    const grouped = STRATA.flatMap(s => strata.filter(x => x === s))
    expect(strata).not.toEqual(grouped)
    expect(set.items[0].state).toMatch(/^Title: T\d+/)
  })

  it('leaves out an article whose title is an example in its own importance question', () => {
    const r = new Map(results)
    const p = prodFor(1, 'ESSENTIAL')
    r.set(p.key, { ...p, questionText: 'Liked: "Title 1"' })
    const set = labelingSet(sample, r, { seed: 7, size: 60, perStratum: 15 })
    expect(set.excludedAsExamples).toBe(1)
    expect(set.items.some(i => i.articleId === 1)).toBe(false)
    expect(set.strataSizes.ESSENTIAL).toBe(29)
  })
})

describe('analyzeLabels', () => {
  it('weights each stratum by its size in the sample and reports both accuracies', () => {
    // Sample: 80 ESSENTIAL, 20 undecided. Labeled: 2 ESSENTIAL (1 right), 2 undecided (labels USEFUL and SKIP)
    const results = new Map<string, BenchRecord>()
    const articles: ArticleMeta[] = []
    for (let i = 1; i <= 100; i++) {
      articles.push(meta(i))
      const r = prodFor(i, i <= 80 ? 'ESSENTIAL' : null)
      results.set(r.key, r)
    }
    const set = labelingSet(sampleOf(articles), results, { seed: 3, size: 4, perStratum: 2 })
    const e = set.items.filter(i => i.stratum === 'ESSENTIAL').map(i => String(i.articleId))
    const u = set.items.filter(i => i.stratum === 'UNDECIDED').map(i => String(i.articleId))
    const labels: Record<string, ImportanceLabel> = { [e[0]]: 'ESSENTIAL', [e[1]]: 'SKIP', [u[0]]: 'USEFUL', [u[1]]: 'SKIP' }

    const a = analyzeLabels(set, results, labels, [0, 0.3], 0.3, false)
    expect(a.labeled).toBe(4)
    expect(a.weights.find(w => w.stratum === 'ESSENTIAL')!.weight).toBe(40)
    expect(a.weights.find(w => w.stratum === 'UNDECIDED')!.weight).toBe(10)
    // Abstention: only the ESSENTIAL stratum decides, 1 of 2 right
    expect(a.production.abstention.hit / a.production.abstention.n).toBeCloseTo(0.5)
    expect(a.production.coverage.hit / a.production.coverage.n).toBeCloseTo(0.8)
    // As in production: (40 * 1 + 10 * 1) / 100 (undecided read as USEFUL is right once)
    expect(a.production.asProduction!.hit / a.production.asProduction!.n).toBeCloseTo(0.5)
    expect(a.production.confusion[3]).toEqual([0, 1, 1])
    expect(a.uncoveredStrata).toEqual([])
    expect(a.rotations).toBeNull()
    expect(a.sweep).toHaveLength(2)
  })
})

describe('compareRotations and diagnoseRepro', () => {
  const articles = [
    meta(1, { importance: 'ESSENTIAL' }),
    meta(2, { importance: 'SKIP', theme: 'AI' }),
    meta(3, { importance: null, classifiedAt: '2026-10-01T00:00:00.000Z' }),
    meta(4, { importance: 'USEFUL' }),
  ]
  const results = new Map<string, BenchRecord>()
  for (const [id, byId] of [
    [1, { ESSENTIAL: 0.9, USEFUL: 0.05, SKIP: 0.05 }],
    [2, { ESSENTIAL: 0.05, USEFUL: 0.9, SKIP: 0.05 }],
    [3, { ESSENTIAL: 0.05, USEFUL: 0.9, SKIP: 0.05 }],
    [4, { ESSENTIAL: 0.6, USEFUL: 0.3, SKIP: 0.1 }],
  ] as const) {
    for (const [k, reading] of (['production', 'rotation1', 'rotation2'] as const).entries()) {
      const r = rec(id, reading, rotate(IDS, k), id === 4 && k > 0 ? { ESSENTIAL: 0.1, USEFUL: 0.8, SKIP: 0.1 } : byId)
      results.set(r.key, r)
    }
    const theme = rec(id, 'production', ['AI', 'OTHER'], { AI: 0.9, OTHER: 0.1 })
    results.set(recordKey(id, 'production', 'theme'), { ...theme, key: recordKey(id, 'production', 'theme'), question: 'theme', choice: id === 4 ? 'OTHER' : 'AI' })
  }
  const sample = sampleOf(articles)

  it('compares the two readings over the sample', () => {
    const c = compareRotations(sample, results, 0.3)!
    expect(c.articles).toBe(4)
    expect(c.production.distribution).toMatchObject({ ESSENTIAL: 2, USEFUL: 2 })
    expect(c.rotations.distribution.USEFUL).toBe(3)
    expect(c.appliedChanged).toBe(1)
  })

  it('splits the gaps into context changes, unexplained and never asked', () => {
    const contexts = new Map([
      [2, { articleId: 2, theme: 'AI', instructionUpdatedAt: '2026-11-05 10:00:00', votesAfter: 0 }],
    ])
    const d = diagnoseRepro(sample, results, contexts, '2026-10-15 00:00:00', 0.3, true)
    expect(d.compared).toBe(4)
    const cause = Object.fromEntries(d.rows.map(r => [r.articleId, r.cause]))
    // 1 matches; 2: instruction edited after classification; 3: classified before importance; 4: theme read differently
    expect(cause).toEqual({ 2: 'context', 3: 'not-asked', 4: 'context' })
    expect(d.rows.find(r => r.articleId === 4)!.themeChanged).toBe(true)
    expect(d.rows.find(r => r.articleId === 4)!.rotations).toBe('USEFUL')

    const none = diagnoseRepro(sample, results, new Map(), null, 0.3, false)
    expect(Object.fromEntries(none.rows.map(r => [r.articleId, r.cause]))).toEqual({ 2: 'unexplained', 3: 'unexplained', 4: 'context' })
    expect(none.rows[0].rotations).toBe('–')
  })
})
