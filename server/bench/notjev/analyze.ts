import notjev from 'notjev'
import {
  analyzeLabels,
  compareRotations,
  diagnoseRepro,
  labelingSet,
  type LabelAnalysis,
  type LabelingSet,
  type ReproDiagnosis,
  type RotationComparison,
} from './importance.js'
import {
  QUESTIONS,
  ROTATION_READINGS,
  recordKey,
  type ImportanceContext,
  type ImportanceLabel,
  type ArbitrationFile,
  type ArticleMeta,
  type BenchQuestion,
  type BenchRecord,
  type DecideRecord,
  type ReasonedRecord,
  type SampleFile,
} from './types.js'
import { mean, median } from './util.js'

/**
 * All the figures of the report, computed from the recorded results only:
 * no call is made here, so arbitrations or another theta are re-read offline.
 */

export const NONE = '__NONE__'
const BANDS = ['low', 'med', 'high', 'certain'] as const

export interface Rate { hit: number; n: number }

export interface SweepPoint {
  theta: number
  decidedPct: number
  /** Agreement with the reference (or arbitrated truth) among decided verdicts */
  agree: Rate
  /** Importance only: label accuracy of the applied verdict (undecided read as USEFUL) */
  strict?: Rate
  soft?: Rate
}

export interface Disagreement {
  articleId: number
  question: BenchQuestion
  title: string
  feed: string | null
  url: string
  excerpt: string
  notjev: string
  notjevDecided: boolean
  reference: string
  p1: number
  margin: number
  band: string
}

export interface QuestionAnalysis {
  question: BenchQuestion
  theta: number
  articles: number
  degraded: number
  undecided: number
  reference: { ok: number; unreadable: number; truncated: number; missing: number }
  agreeDecided: Rate
  agreeTop: Rate
  nullArm: { cls: string; rate: Rate }
  arbitrated: { notjev: Rate; reference: Rate; pending: number; total: number } | null
  confusion: { rows: string[]; cols: string[]; cells: number[][] }
  sweep: SweepPoint[]
  bands: Array<{ band: string; agree: Rate }>
  position: {
    changedTop: Rate
    changedChoice: Rate
    lettersProduction: Record<string, number>
    lettersShuffled: Record<string, number>
  }
  coverage: { mean: number; hist: Array<{ label: string; count: number }> }
  ms: { production: { mean: number; median: number }; reasoned: { mean: number; median: number } }
  repro: Rate & { mismatches: Array<{ articleId: number; title: string; stored: string; now: string }> }
  labels?: {
    positives: number
    negatives: number
    conflicts: number
    strict: Rate
    soft: Rate
    nullStrict: Rate
    nullSoft: Rate
    refStrict: Rate
    refSoft: Rate
  }
  disagreements: Disagreement[]
}

/** Inputs of the importance-specific figures (labels, rotations, reproducibility diagnosis) */
export interface ImportanceInputs {
  seed: number
  rotations: boolean
  labeling: { size: number; perStratum: number }
  labels: Record<string, ImportanceLabel>
  contexts: Map<number, ImportanceContext>
  /** When migration 0022 (importance) was applied, from the snapshot's _migrations */
  importanceSince: string | null
}

export interface ImportanceAnalysis {
  theta: number
  rotationsOn: boolean
  labeling: LabelingSet
  labels: LabelAnalysis
  rotations: RotationComparison | null
  repro: ReproDiagnosis
}

export interface Analysis {
  questions: QuestionAnalysis[]
  importance: ImportanceAnalysis | null
  totals: {
    articles: number
    articlesComplete: number
    calls: number
    degradedReadouts: number
    reasonedUnreadable: number
    firstCallAt: string | null
    lastCallAt: string | null
    productionMs: number
    shuffledMs: number
    rotationsMs: number
    reasonedMs: number
  }
  arbitrations: ArbitrationFile['items']
}

const rate = (hit: number, n: number): Rate => ({ hit, n })

function inc(map: Record<string, number>, k: string): void {
  map[k] = (map[k] ?? 0) + 1
}

function letterOf(rec: DecideRecord, id: string): string {
  const i = rec.options.indexOf(id)
  return i >= 0 ? String.fromCharCode(65 + i) : '?'
}

/** Re-read a recorded readout at another theta, with the reader production uses */
function reread(rec: DecideRecord, theta: number) {
  return notjev.readResponse(rec.resp, { options: rec.options, theta })
}

/** Importance as the journal applies it: an undecided verdict counts as USEFUL */
function applied(choice: string | null): string {
  return choice ?? 'USEFUL'
}

function labelHit(label: ArticleMeta['label'], verdict: string, soft: boolean): boolean {
  if (label === 'negative') return verdict === 'SKIP'
  return soft ? verdict === 'ESSENTIAL' || verdict === 'USEFUL' : verdict === 'ESSENTIAL'
}

function coverageHist(values: number[]): Array<{ label: string; count: number }> {
  const edges: Array<[number, number, string]> = [
    [0, 0.5, '< 0.50'], [0.5, 0.9, '0.50-0.90'], [0.9, 0.99, '0.90-0.99'], [0.99, 0.999, '0.99-0.999'], [0.999, Infinity, '>= 0.999'],
  ]
  return edges.map(([lo, hi, label]) => ({ label, count: values.filter(v => v >= lo && v < hi).length }))
}

function analyzeQuestion(
  question: BenchQuestion,
  sample: SampleFile,
  results: Map<string, BenchRecord>,
  thetas: number[],
  arbitrations: ArbitrationFile['items'],
): QuestionAnalysis {
  const theta = question === 'format' ? sample.settings.formatTheta
    : question === 'theme' ? sample.settings.themeTheta : sample.settings.importanceTheta

  const rows = sample.articles.map(a => ({
    a,
    prod: results.get(recordKey(a.id, 'production', question)) as DecideRecord | undefined,
    shuf: results.get(recordKey(a.id, 'shuffled', question)) as DecideRecord | undefined,
    ref: results.get(recordKey(a.id, 'reasoned', question)) as ReasonedRecord | undefined,
  })).filter(r => r.prod)

  const reference = { ok: 0, unreadable: 0, truncated: 0, missing: 0 }
  for (const r of rows) {
    if (!r.ref) reference.missing++
    else reference[r.ref.status]++
  }

  // Truth for a row: the reference when it agrees with notjev's top, the
  // reader's arbitration when they disagree; null when unknown
  const truthOf = (r: typeof rows[number]): string | null => {
    if (!r.ref?.choice || !r.prod) return null
    if (r.prod.top === r.ref.choice) return r.ref.choice
    const v = arbitrations[`${r.a.id}|${question}`]
    if (v === 'notjev') return r.prod.top
    if (v === 'reference') return r.ref.choice
    if (v === 'neither') return NONE
    return null
  }

  const readable = rows.filter(r => r.ref?.choice && !r.prod!.degraded)
  const agreeTop = rate(readable.filter(r => r.prod!.top === r.ref!.choice).length, readable.length)
  const decided = readable.filter(r => r.prod!.choice !== null)
  const agreeDecided = rate(decided.filter(r => r.prod!.choice === r.ref!.choice).length, decided.length)

  // Null arm: always answer the reference's most frequent class
  const refCounts: Record<string, number> = {}
  for (const r of readable) inc(refCounts, r.ref!.choice!)
  const majority = Object.entries(refCounts).sort((x, y) => y[1] - x[1])[0]
  const nullArm = { cls: majority?.[0] ?? '-', rate: rate(majority?.[1] ?? 0, readable.length) }

  // Arbitrated accuracy (only once at least one disagreement is arbitrated)
  const disagreeing = readable.filter(r => r.prod!.top !== r.ref!.choice)
  const arbitratedCount = disagreeing.filter(r => arbitrations[`${r.a.id}|${question}`]).length
  let arbitrated: QuestionAnalysis['arbitrated'] = null
  if (arbitratedCount > 0) {
    const known = readable.filter(r => truthOf(r) !== null)
    arbitrated = {
      notjev: rate(known.filter(r => r.prod!.top === truthOf(r)).length, known.length),
      reference: rate(known.filter(r => r.ref!.choice === truthOf(r)).length, known.length),
      pending: disagreeing.length - arbitratedCount,
      total: disagreeing.length,
    }
  }
  const truthFor = (r: typeof rows[number]): string | null => arbitratedCount > 0 ? truthOf(r) : (r.ref?.choice ?? null)

  // Confusion: notjev verdict (or UNDECIDED / DEGRADED) x reference (or UNREADABLE)
  const optionIds = rows[0]?.prod?.options.slice().sort() ?? []
  const rowLabels = [...optionIds, 'UNDECIDED', 'DEGRADED']
  const colLabels = [...optionIds, 'UNREADABLE']
  const cells = rowLabels.map(() => colLabels.map(() => 0))
  for (const r of rows) {
    if (!r.ref) continue
    const rl = r.prod!.degraded ? 'DEGRADED' : r.prod!.choice ?? 'UNDECIDED'
    const cl = r.ref.choice ?? 'UNREADABLE'
    const i = rowLabels.indexOf(rl)
    const j = colLabels.indexOf(cl)
    if (i >= 0 && j >= 0) cells[i][j]++
  }

  // Theta sweep on the recorded distributions
  const sweep: SweepPoint[] = thetas.map(t => {
    const reads = rows.map(r => ({ r, d: reread(r.prod!, t) }))
    const withTruth = reads.filter(x => truthFor(x.r) !== null && !x.d.degraded)
    const dec = withTruth.filter(x => x.d.choice !== null)
    const point: SweepPoint = {
      theta: t,
      decidedPct: reads.length ? reads.filter(x => x.d.choice !== null).length / reads.length : 0,
      agree: rate(dec.filter(x => x.d.choice === truthFor(x.r)).length, dec.length),
    }
    if (question === 'importance') {
      const lab = reads.filter(x => x.r.a.label === 'positive' || x.r.a.label === 'negative')
      point.strict = rate(lab.filter(x => labelHit(x.r.a.label, applied(x.d.choice), false)).length, lab.length)
      point.soft = rate(lab.filter(x => labelHit(x.r.a.label, applied(x.d.choice), true)).length, lab.length)
    }
    return point
  })

  // Does the displayed confidence hold? Agreement of the top answer per band
  const bands = BANDS.map(band => {
    const inBand = rows.filter(r => r.prod!.band === band && !r.prod!.degraded && truthFor(r) !== null)
    return { band, agree: rate(inBand.filter(r => r.prod!.top === truthFor(r)).length, inBand.length) }
  })

  // Position bias
  const paired = rows.filter(r => r.shuf && !r.prod!.degraded && !r.shuf.degraded)
  const changedTop = rate(paired.filter(r => r.prod!.top !== r.shuf!.top).length, paired.length)
  const bothDecided = paired.filter(r => r.prod!.choice !== null && r.shuf!.choice !== null)
  const changedChoice = rate(bothDecided.filter(r => r.prod!.choice !== r.shuf!.choice).length, bothDecided.length)
  const lettersProduction: Record<string, number> = {}
  const lettersShuffled: Record<string, number> = {}
  for (const r of rows) if (!r.prod!.degraded) inc(lettersProduction, letterOf(r.prod!, r.prod!.top))
  for (const r of paired) inc(lettersShuffled, letterOf(r.shuf!, r.shuf!.top))

  const cov = rows.map(r => r.prod!.coverage)

  // Reproducibility against the values stored by the app
  const storedKey = question === 'format' ? 'format' : question === 'theme' ? 'theme' : 'importance'
  const classified = rows.filter(r => r.a.stored.classifiedAt)
  const mismatches = classified
    .filter(r => (r.a.stored[storedKey] ?? null) !== r.prod!.choice)
    .map(r => ({ articleId: r.a.id, title: r.a.title, stored: r.a.stored[storedKey] ?? 'NULL', now: r.prod!.choice ?? 'NULL' }))

  let labels: QuestionAnalysis['labels']
  if (question === 'importance') {
    const lab = rows.filter(r => r.a.label === 'positive' || r.a.label === 'negative')
    const pos = lab.filter(r => r.a.label === 'positive').length
    const neg = lab.length - pos
    const refLab = lab.filter(r => r.ref?.choice)
    labels = {
      positives: pos,
      negatives: neg,
      conflicts: rows.filter(r => r.a.label === 'conflict').length,
      strict: rate(lab.filter(r => labelHit(r.a.label, applied(r.prod!.choice), false)).length, lab.length),
      soft: rate(lab.filter(r => labelHit(r.a.label, applied(r.prod!.choice), true)).length, lab.length),
      // A constant answer: ESSENTIAL (or USEFUL) is right on every positive, SKIP on every negative
      nullStrict: rate(Math.max(pos, neg), lab.length),
      nullSoft: rate(Math.max(pos, neg), lab.length),
      refStrict: rate(refLab.filter(r => labelHit(r.a.label, r.ref!.choice!, false)).length, refLab.length),
      refSoft: rate(refLab.filter(r => labelHit(r.a.label, r.ref!.choice!, true)).length, refLab.length),
    }
  }

  const disagreements: Disagreement[] = disagreeing.map(r => ({
    articleId: r.a.id,
    question,
    title: r.a.title,
    feed: r.a.feed,
    url: r.a.url,
    excerpt: r.a.excerpt,
    notjev: r.prod!.top,
    notjevDecided: r.prod!.choice !== null,
    reference: r.ref!.choice!,
    p1: r.prod!.p1,
    margin: r.prod!.margin,
    band: r.prod!.band,
  }))

  return {
    question,
    theta,
    articles: rows.length,
    degraded: rows.filter(r => r.prod!.degraded).length,
    undecided: rows.filter(r => r.prod!.choice === null).length,
    reference,
    agreeDecided,
    agreeTop,
    nullArm,
    arbitrated,
    confusion: { rows: rowLabels, cols: colLabels, cells },
    sweep,
    bands,
    position: { changedTop, changedChoice, lettersProduction, lettersShuffled },
    coverage: { mean: mean(cov), hist: coverageHist(cov) },
    ms: {
      production: { mean: mean(rows.map(r => r.prod!.ms)), median: median(rows.map(r => r.prod!.ms)) },
      reasoned: { mean: mean(rows.filter(r => r.ref).map(r => r.ref!.ms)), median: median(rows.filter(r => r.ref).map(r => r.ref!.ms)) },
    },
    repro: { ...rate(classified.length - mismatches.length, classified.length), mismatches },
    labels,
    disagreements,
  }
}

export function analyze(
  sample: SampleFile,
  results: Map<string, BenchRecord>,
  thetas: number[],
  arbitrations: ArbitrationFile['items'] = {},
  inputs: ImportanceInputs | null = null,
): Analysis {
  const all = [...results.values()]
  const sum = (xs: BenchRecord[]) => xs.reduce((a, r) => a + r.ms, 0)
  const at = all.map(r => r.at).sort()
  const complete = sample.articles.filter(a => QUESTIONS.every(q =>
    ['production', 'shuffled', 'reasoned'].every(rd => results.has(`${a.id}|${rd}|${q}`)))
    && (!inputs?.rotations || ROTATION_READINGS.every(rd => results.has(recordKey(a.id, rd, 'importance'))))).length
  let importance: ImportanceAnalysis | null = null
  if (inputs) {
    const theta = sample.settings.importanceTheta
    const labeling = labelingSet(sample, results, { seed: inputs.seed, ...inputs.labeling })
    importance = {
      theta,
      rotationsOn: inputs.rotations,
      labeling,
      labels: analyzeLabels(labeling, results, inputs.labels, thetas, theta, inputs.rotations),
      rotations: inputs.rotations ? compareRotations(sample, results, theta) : null,
      repro: diagnoseRepro(sample, results, inputs.contexts, inputs.importanceSince, theta, inputs.rotations),
    }
  }
  return {
    questions: QUESTIONS.map(q => analyzeQuestion(q, sample, results, thetas, arbitrations)),
    importance,
    totals: {
      articles: sample.articles.length,
      articlesComplete: complete,
      calls: all.length,
      degradedReadouts: all.filter(r => r.reading !== 'reasoned' && (r as DecideRecord).degraded).length,
      reasonedUnreadable: all.filter(r => r.reading === 'reasoned' && (r as ReasonedRecord).status !== 'ok').length,
      firstCallAt: at[0] ?? null,
      lastCallAt: at[at.length - 1] ?? null,
      productionMs: sum(all.filter(r => r.reading === 'production')),
      shuffledMs: sum(all.filter(r => r.reading === 'shuffled')),
      rotationsMs: sum(all.filter(r => r.reading === 'rotation1' || r.reading === 'rotation2')),
      reasonedMs: sum(all.filter(r => r.reading === 'reasoned')),
    },
    arbitrations,
  }
}

/** The `notjev replay` recording: one-token readouts, gold = the readable reasoned reference */
export function replayRecording(sample: SampleFile, results: Map<string, BenchRecord>) {
  const rows: Array<Record<string, unknown>> = []
  for (const a of sample.articles) {
    for (const q of QUESTIONS) {
      const ref = results.get(recordKey(a.id, 'reasoned', q)) as ReasonedRecord | undefined
      for (const reading of ['production', 'shuffled'] as const) {
        const r = results.get(recordKey(a.id, reading, q)) as DecideRecord | undefined
        if (!r) continue
        rows.push({
          id: `${a.id}:${reading}:${q}`,
          family: `${q}/${reading}`,
          options: r.options,
          resp: r.resp,
          ms: r.ms,
          ...(ref?.choice ? { gold: ref.choice } : {}),
        })
      }
    }
  }
  return { model: sample.settings.model, at: new Date().toISOString(), results: rows }
}
