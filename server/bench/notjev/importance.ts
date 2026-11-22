import notjev from 'notjev'
import {
  recordKey,
  ROTATION_READINGS,
  type BenchRecord,
  type DecideRecord,
  type ImportanceContext,
  type ImportanceLabel,
  type ReasonedRecord,
  type SampleFile,
} from './types.js'
import { hashSeed, rng, shuffle } from './util.js'

/**
 * The importance-specific part of the report, computed from recorded results
 * only (no call): the blind labeling set, the "importance by rotations"
 * reading, accuracy against the reader's labels (weighted back to the sample,
 * since the labeling draw is stratified), and the reproducibility diagnosis.
 */

export const VERDICTS = ['ESSENTIAL', 'USEFUL', 'SKIP'] as const
export type Verdict = typeof VERDICTS[number]
export const STRATA = ['ESSENTIAL', 'USEFUL', 'SKIP', 'UNDECIDED'] as const
export type Stratum = typeof STRATA[number]

/** A weighted rate: `hit` and `n` are sums of weights, `count` the raw number of articles */
export interface WRate { hit: number; n: number; count: number }

const BANDS = ['low', 'med', 'high', 'certain'] as const

// ---------- small readers ----------

/** Importance as the journal applies it: an undecided verdict counts as USEFUL (shared/classification.ts) */
export function applied(choice: string | null): string {
  return choice ?? 'USEFUL'
}

/** SQLite `datetime('now')` (UTC, no zone) or ISO -> epoch ms; NaN when unreadable */
export function parseTs(s: string | null | undefined): number {
  if (!s) return NaN
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(' ', 'T') + 'Z'
  return Date.parse(iso)
}

/**
 * The article text exactly as the model saw it: the "Context:" block of the
 * recorded request (notjev renderTurn), between the tag and the question line.
 */
export function extractState(request: unknown): string | null {
  const messages = (request as { messages?: Array<{ content?: unknown }> } | null)?.messages
  if (!Array.isArray(messages)) return null
  for (const m of messages) {
    if (typeof m.content !== 'string') continue
    const start = m.content.indexOf('Context:\n')
    if (start < 0) continue
    const end = m.content.lastIndexOf('\n\nQuestion: ')
    if (end <= start) continue
    return m.content.slice(start + 'Context:\n'.length, end)
  }
  return null
}

// ---------- rotations ----------

export interface RotationVerdict {
  choice: string | null
  top: string
  p1: number
  margin: number
  band: string
  degraded: boolean
  /** Averaged distribution, keyed by option id */
  byOption: Record<string, number>
}

/**
 * The "importance by rotations" reading: each rotation's distribution is read
 * back onto the option ids, the three are averaged, and the margin rule of
 * production (notjev readout.decide) is applied at `theta`. A degraded
 * rotation makes the whole reading degraded, hence undecided, as a degraded
 * readout never yields a verdict in production.
 */
export function rotationReading(recs: DecideRecord[], ids: readonly string[], theta: number): RotationVerdict | null {
  if (recs.length === 0) return null
  const sum: Record<string, number> = Object.fromEntries(ids.map(id => [id, 0]))
  let degraded = false
  for (const rec of recs) {
    const d = notjev.readResponse(rec.resp, { options: rec.options, theta })
    if (d.degraded) degraded = true
    rec.options.forEach((id, i) => { if (id in sum) sum[id] += d.probabilities[i] ?? 0 })
  }
  const byOption = Object.fromEntries(ids.map(id => [id, sum[id] / recs.length]))
  const v = notjev.readout.decide({ probabilities: ids.map(id => byOption[id]), options: [...ids], theta })
  const undecided = v.undecided || degraded
  return { choice: undecided ? null : v.choice, top: v.top, p1: v.p1, margin: v.margin, band: v.band, degraded, byOption }
}

/** The three importance readouts of an article (production + 2 rotations), or null when one is missing */
function rotationRecords(results: Map<string, BenchRecord>, articleId: number): DecideRecord[] | null {
  const prod = results.get(recordKey(articleId, 'production', 'importance')) as DecideRecord | undefined
  const rots = ROTATION_READINGS.map(r => results.get(recordKey(articleId, r, 'importance')) as DecideRecord | undefined)
  if (!prod || rots.some(r => !r)) return null
  return [prod, ...rots as DecideRecord[]]
}

// ---------- labeling set ----------

export interface LabelingItem {
  articleId: number
  stratum: Stratum
  title: string
  feed: string | null
  url: string
  /** The text sent to the model (title, source, body excerpt) */
  state: string
}

export interface LabelingSet {
  items: LabelingItem[]
  /** Size of each verdict stratum among the eligible sample articles (the weights' numerator) */
  strataSizes: Record<Stratum, number>
  drawn: Record<Stratum, number>
  /** Sample articles left out because their title is an example in their own importance question */
  excludedAsExamples: number
}

export function stratumOf(prod: DecideRecord): Stratum {
  return (prod.choice as Stratum | null) ?? 'UNDECIDED'
}

/**
 * The blind labeling draw: `perStratum` articles per production verdict
 * (ESSENTIAL, USEFUL, SKIP, undecided), completed from the other strata when
 * one runs short, then shown in a shuffled order. Fixed seed: the same run
 * always gives the same 60 articles in the same order.
 */
export function labelingSet(
  sample: SampleFile,
  results: Map<string, BenchRecord>,
  opts: { seed: number; size: number; perStratum: number },
): LabelingSet {
  const strataSizes = Object.fromEntries(STRATA.map(s => [s, 0])) as Record<Stratum, number>
  const groups = Object.fromEntries(STRATA.map(s => [s, [] as LabelingItem[]])) as Record<Stratum, LabelingItem[]>
  let excludedAsExamples = 0
  for (const a of sample.articles) {
    const prod = results.get(recordKey(a.id, 'production', 'importance')) as DecideRecord | undefined
    if (!prod) continue
    // Already excluded when sampling; checked again against the question actually sent
    if (a.title && prod.questionText.includes(a.title)) {
      excludedAsExamples++
      continue
    }
    const stratum = stratumOf(prod)
    strataSizes[stratum]++
    groups[stratum].push({
      articleId: a.id,
      stratum,
      title: a.title,
      feed: a.feed,
      url: a.url,
      state: extractState(prod.request) ?? a.excerpt,
    })
  }

  const picked: LabelingItem[] = []
  const leftovers: LabelingItem[] = []
  for (const s of STRATA) {
    const g = shuffle(groups[s], rng(hashSeed(opts.seed, 'labeling', s)))
    picked.push(...g.slice(0, opts.perStratum))
    leftovers.push(...g.slice(opts.perStratum))
  }
  const missing = Math.max(0, opts.size - picked.length)
  picked.push(...shuffle(leftovers, rng(hashSeed(opts.seed, 'labeling', 'complement'))).slice(0, missing))

  const drawn = Object.fromEntries(STRATA.map(s => [s, picked.filter(i => i.stratum === s).length])) as Record<Stratum, number>
  // Blind: never grouped by stratum
  const items = shuffle(picked, rng(hashSeed(opts.seed, 'labeling', 'order')))
  return { items, strataSizes, drawn, excludedAsExamples }
}

// ---------- accuracy against the reader's labels ----------

export interface StratumWeight {
  stratum: Stratum
  size: number
  drawn: number
  labeled: number
  unsure: number
  /** Weight of one labeled article of the stratum: size / labeled */
  weight: number
}

export interface ReadingScore {
  /** Abstention: accuracy among decided verdicts, and the share decided */
  abstention: WRate
  coverage: WRate
  /** As in production: undecided read as USEFUL (absent for the reference) */
  asProduction: WRate | null
  /** Rows: verdict (ESSENTIAL, USEFUL, SKIP, UNDECIDED) · columns: label · raw counts */
  confusion: number[][]
  confusionRows: string[]
}

export interface LabelSweepPoint {
  theta: number
  production: { coverage: WRate; abstention: WRate; asProduction: WRate }
  rotations: { coverage: WRate; abstention: WRate; asProduction: WRate } | null
}

export interface LabelAnalysis {
  labeled: number
  unsure: number
  pending: number
  weights: StratumWeight[]
  /** A stratum present in the sample but with no usable label: the weighted figures leave it out */
  uncoveredStrata: Stratum[]
  production: ReadingScore
  rotations: ReadingScore | null
  reference: ReadingScore
  nullArm: { label: string; rate: WRate }
  bands: Array<{ band: string; production: WRate; rotations: WRate | null }>
  sweep: LabelSweepPoint[]
}

const wrate = (): WRate => ({ hit: 0, n: 0, count: 0 })
function add(r: WRate, w: number, hit: boolean): void {
  r.n += w
  r.count++
  if (hit) r.hit += w
}

function score(rows: Array<{ w: number; label: Verdict; verdict: string | null }>, rowLabels: string[], withApplied: boolean): ReadingScore {
  const abstention = wrate()
  const coverage = wrate()
  const asProduction = wrate()
  const confusion = rowLabels.map(() => VERDICTS.map(() => 0))
  for (const r of rows) {
    add(coverage, r.w, r.verdict !== null)
    if (r.verdict !== null) add(abstention, r.w, r.verdict === r.label)
    add(asProduction, r.w, applied(r.verdict) === r.label)
    const i = rowLabels.indexOf(r.verdict ?? rowLabels[rowLabels.length - 1])
    confusion[i][VERDICTS.indexOf(r.label)]++
  }
  return { abstention, coverage, asProduction: withApplied ? asProduction : null, confusion, confusionRows: rowLabels }
}

export function analyzeLabels(
  set: LabelingSet,
  results: Map<string, BenchRecord>,
  labels: Record<string, ImportanceLabel>,
  thetas: number[],
  theta: number,
  rotationsOn: boolean,
): LabelAnalysis {
  const ids = [...VERDICTS]
  const weights: StratumWeight[] = STRATA.map(s => {
    const inStratum = set.items.filter(i => i.stratum === s)
    const labeled = inStratum.filter(i => VERDICTS.includes(labels[String(i.articleId)] as Verdict)).length
    const unsure = inStratum.filter(i => labels[String(i.articleId)] === 'unsure').length
    return { stratum: s, size: set.strataSizes[s], drawn: inStratum.length, labeled, unsure, weight: labeled ? set.strataSizes[s] / labeled : 0 }
  })
  const weightOf = Object.fromEntries(weights.map(w => [w.stratum, w.weight])) as Record<Stratum, number>

  const rows = set.items
    .filter(i => VERDICTS.includes(labels[String(i.articleId)] as Verdict))
    .map(i => {
      const prod = results.get(recordKey(i.articleId, 'production', 'importance')) as DecideRecord
      const ref = results.get(recordKey(i.articleId, 'reasoned', 'importance')) as ReasonedRecord | undefined
      const rots = rotationsOn ? rotationRecords(results, i.articleId) : null
      return { item: i, w: weightOf[i.stratum], label: labels[String(i.articleId)] as Verdict, prod, ref, rots }
    })

  const production = score(rows.map(r => ({ w: r.w, label: r.label, verdict: r.prod.choice })), [...VERDICTS, 'UNDECIDED'], true)
  const withRot = rows.filter(r => r.rots)
  const rotations = rotationsOn && withRot.length
    ? score(withRot.map(r => ({ w: r.w, label: r.label, verdict: rotationReading(r.rots!, ids, theta)!.choice })), [...VERDICTS, 'UNDECIDED'], true)
    : null
  const withRef = rows.filter(r => r.ref)
  const reference = score(withRef.map(r => ({ w: r.w, label: r.label, verdict: r.ref!.choice })), [...VERDICTS, 'UNREADABLE'], false)

  // Null arm: always the most frequent label (weighted)
  const byLabel: Record<string, number> = {}
  let total = 0
  for (const r of rows) {
    byLabel[r.label] = (byLabel[r.label] ?? 0) + r.w
    total += r.w
  }
  const top = Object.entries(byLabel).sort((a, b) => b[1] - a[1])[0]
  const nullArm = { label: top?.[0] ?? '-', rate: { hit: top?.[1] ?? 0, n: total, count: rows.length } }

  // Accuracy of the top answer by band (the band says how sure the readout looked)
  const bands = BANDS.map(band => {
    const p = wrate()
    for (const r of rows) if (r.prod.band === band && !r.prod.degraded) add(p, r.w, r.prod.top === r.label)
    let rot: WRate | null = null
    if (rotations) {
      rot = wrate()
      for (const r of withRot) {
        const v = rotationReading(r.rots!, ids, theta)!
        if (v.band === band && !v.degraded) add(rot, r.w, v.top === r.label)
      }
    }
    return { band, production: p, rotations: rot }
  })

  const sweep: LabelSweepPoint[] = thetas.map(t => {
    const prodRows = rows.map(r => ({ w: r.w, label: r.label, verdict: notjev.readResponse(r.prod.resp, { options: r.prod.options, theta: t }).choice }))
    const ps = score(prodRows, [...VERDICTS, 'UNDECIDED'], true)
    let rs: LabelSweepPoint['rotations'] = null
    if (rotations) {
      const s = score(withRot.map(r => ({ w: r.w, label: r.label, verdict: rotationReading(r.rots!, ids, t)!.choice })), [...VERDICTS, 'UNDECIDED'], true)
      rs = { coverage: s.coverage, abstention: s.abstention, asProduction: s.asProduction! }
    }
    return { theta: t, production: { coverage: ps.coverage, abstention: ps.abstention, asProduction: ps.asProduction! }, rotations: rs }
  })

  const labeledCount = rows.length
  const unsure = set.items.filter(i => labels[String(i.articleId)] === 'unsure').length
  return {
    labeled: labeledCount,
    unsure,
    pending: set.items.length - labeledCount - unsure,
    weights,
    uncoveredStrata: weights.filter(w => w.size > 0 && w.labeled === 0).map(w => w.stratum),
    production,
    rotations,
    reference,
    nullArm,
    bands,
    sweep,
  }
}

// ---------- rotations against production, whole sample ----------

export interface ReadingSummary {
  articles: number
  undecided: number
  degraded: number
  distribution: Record<string, number>
  /** Agreement with the readable reasoned reference, decided verdicts */
  agreeReference: { hit: number; n: number }
}

export interface RotationComparison {
  articles: number
  production: ReadingSummary
  rotations: ReadingSummary
  /** Articles whose applied verdict (undecided = USEFUL) differs between the two readings */
  appliedChanged: number
  /** Verdict moves, production -> rotations, raw counts (rows production, columns rotations) */
  moves: number[][]
}

function summarize(rows: Array<{ choice: string | null; degraded: boolean; ref: string | null }>): ReadingSummary {
  const distribution: Record<string, number> = { ESSENTIAL: 0, USEFUL: 0, SKIP: 0, UNDECIDED: 0 }
  let hit = 0
  let n = 0
  for (const r of rows) {
    distribution[r.choice ?? 'UNDECIDED']++
    if (r.choice !== null && r.ref) {
      n++
      if (r.choice === r.ref) hit++
    }
  }
  return {
    articles: rows.length,
    undecided: rows.filter(r => r.choice === null).length,
    degraded: rows.filter(r => r.degraded).length,
    distribution,
    agreeReference: { hit, n },
  }
}

export function compareRotations(sample: SampleFile, results: Map<string, BenchRecord>, theta: number): RotationComparison | null {
  const ids = [...VERDICTS]
  const rows = sample.articles.flatMap(a => {
    const recs = rotationRecords(results, a.id)
    if (!recs) return []
    const ref = results.get(recordKey(a.id, 'reasoned', 'importance')) as ReasonedRecord | undefined
    return [{ prod: recs[0], rot: rotationReading(recs, ids, theta)!, ref: ref?.choice ?? null }]
  })
  if (!rows.length) return null
  const order = [...STRATA]
  const moves = order.map(() => order.map(() => 0))
  for (const r of rows) moves[order.indexOf((r.prod.choice ?? 'UNDECIDED') as Stratum)][order.indexOf((r.rot.choice ?? 'UNDECIDED') as Stratum)]++
  return {
    articles: rows.length,
    production: summarize(rows.map(r => ({ choice: r.prod.choice, degraded: r.prod.degraded, ref: r.ref }))),
    rotations: summarize(rows.map(r => ({ choice: r.rot.choice, degraded: r.rot.degraded, ref: r.ref }))),
    appliedChanged: rows.filter(r => applied(r.prod.choice) !== applied(r.rot.choice)).length,
    moves,
  }
}

// ---------- reproducibility diagnosis ----------

export type ReproCause = 'not-asked' | 'context' | 'unexplained'

export interface ReproRow {
  articleId: number
  title: string
  stored: string
  production: string
  shuffled: string
  rotations: string
  themeStored: string
  themeNow: string
  instructionChanged: boolean
  votesAfter: number
  themeChanged: boolean
  cause: ReproCause
}

export interface ReproDiagnosis {
  /** Articles whose stored importance can be compared (classified) */
  compared: number
  rows: ReproRow[]
  byCause: Record<ReproCause, number>
  importanceSince: string | null
}

const show = (v: string | null | undefined): string => v ?? 'UNDECIDED'

/**
 * Every article whose importance read today differs from articles.importance,
 * with what could explain it. "context": the reader context of the importance
 * question (instruction, votes of the theme, or the theme itself) changed
 * after the article was classified. "not-asked": classified before importance
 * existed (migration 0022), so NULL means "never asked", not "undecided".
 */
export function diagnoseRepro(
  sample: SampleFile,
  results: Map<string, BenchRecord>,
  contexts: Map<number, ImportanceContext>,
  importanceSince: string | null,
  theta: number,
  rotationsOn: boolean,
): ReproDiagnosis {
  const ids = [...VERDICTS]
  const since = parseTs(importanceSince)
  const rows: ReproRow[] = []
  let compared = 0
  for (const a of sample.articles) {
    const prod = results.get(recordKey(a.id, 'production', 'importance')) as DecideRecord | undefined
    if (!prod || !a.stored.classifiedAt) continue
    compared++
    if ((a.stored.importance ?? null) === prod.choice) continue
    const shuf = results.get(recordKey(a.id, 'shuffled', 'importance')) as DecideRecord | undefined
    const recs = rotationsOn ? rotationRecords(results, a.id) : null
    const themeNow = (results.get(recordKey(a.id, 'production', 'theme')) as DecideRecord | undefined)?.choice ?? null
    const ctx = contexts.get(a.id)
    const classifiedAt = parseTs(a.stored.classifiedAt)
    const instructionChanged = !!ctx?.instructionUpdatedAt && parseTs(ctx.instructionUpdatedAt) > classifiedAt
    const votesAfter = ctx?.votesAfter ?? 0
    const themeChanged = (a.stored.theme ?? null) !== themeNow
    const notAsked = a.stored.importance === null && Number.isFinite(since) && classifiedAt < since
    const cause: ReproCause = notAsked ? 'not-asked'
      : instructionChanged || votesAfter > 0 || themeChanged ? 'context' : 'unexplained'
    rows.push({
      articleId: a.id,
      title: a.title,
      stored: a.stored.importance ?? 'NULL',
      production: show(prod.choice),
      shuffled: shuf ? show(shuf.choice) : '–',
      rotations: recs ? show(rotationReading(recs, ids, theta)!.choice) : '–',
      themeStored: a.stored.theme ?? 'NULL',
      themeNow: themeNow ?? 'UNDECIDED',
      instructionChanged,
      votesAfter,
      themeChanged,
      cause,
    })
  }
  const byCause: Record<ReproCause, number> = { 'not-asked': 0, context: 0, unexplained: 0 }
  for (const r of rows) byCause[r.cause]++
  return { compared, rows, byCause, importanceSince }
}
