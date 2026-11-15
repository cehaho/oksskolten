import fs from 'node:fs'
import type { Client, Decision, Question } from 'notjev'
import { getArticleById } from '../../db/articles.js'
import {
  buildClassifyState,
  buildImportanceQuestion,
  createClassifyClient,
  getClassificationSettings,
  resolveModel,
  toOptions,
  FORMAT_QUESTION,
  THEME_QUESTION,
} from '../../ai/classify.js'
import { getVllmApiKey } from '../../ai/providers/llm/vllm.js'
import { getReaderContext } from '../../intelligence/journal-db.js'
import { toWellFormedText } from '../../lib/text.js'
import { FORMATS, IMPORTANCE, DEFAULT_IMPORTANCE_THETA } from '../../../shared/classification.js'
import type { BenchConfig } from './config.js'
import {
  ROTATION_READINGS,
  recordKey,
  type BenchQuestion,
  type BenchRecord,
  type DecideRecord,
  type ReasonedRecord,
} from './types.js'
import { extractLetter, hashSeed, permute, rotate } from './util.js'

/**
 * The calls of the bench. Every prompt piece comes from classify.ts so the
 * production reading is byte for byte what classifyArticle() sends.
 * Must run with DATABASE_URL pointing at the snapshot.
 */

type Option = { id: string; description: string }

interface QuestionSpec {
  question: BenchQuestion
  text: string
  options: Option[]
  theta: number
}

export function loadResults(file: string): Map<string, BenchRecord> {
  const out = new Map<string, BenchRecord>()
  if (!fs.existsSync(file)) return out
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try {
      const r = JSON.parse(line) as BenchRecord
      out.set(r.key, r)
    } catch {
      // A line cut by a crash mid-write: the call is simply made again
    }
  }
  return out
}

function decideRecord(d: Decision, base: Omit<DecideRecord, 'resp' | 'choice' | 'top' | 'p1' | 'p2' | 'margin' | 'band' | 'coverage' | 'degraded' | 'undecided' | 'letters' | 'probabilities' | 'ms' | 'at' | 'request'>): DecideRecord {
  return {
    ...base,
    request: d.request ?? {},
    resp: d.raw,
    choice: d.choice,
    top: d.top,
    p1: d.p1,
    p2: d.p2,
    margin: d.margin,
    band: d.band,
    coverage: d.coverage,
    degraded: d.degraded,
    undecided: d.undecided,
    letters: d.letters,
    probabilities: d.probabilities,
    ms: d.ms ?? 0,
    at: new Date().toISOString(),
  }
}

interface ChatResponse {
  choices?: Array<{ message?: { content?: string | null; reasoning_content?: string | null; reasoning?: string | null }; finish_reason?: string | null }>
  usage?: unknown
}

async function postWithRetry(url: string, init: RequestInit, timeoutMs: number): Promise<ChatResponse> {
  let last: unknown = null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
      if (r.ok) return await r.json() as ChatResponse
      last = new Error(`${url} answered HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`)
      if (r.status < 500 && r.status !== 429) break
    } catch (err) {
      last = err
    }
  }
  throw last instanceof Error ? last : new Error(String(last))
}

export class BenchRunner {
  private client: Client
  private readonly apiKey: string
  private readonly formatSpec: QuestionSpec
  private readonly themeSpec: QuestionSpec

  constructor(
    private readonly cfg: BenchConfig,
    private readonly results: Map<string, BenchRecord>,
    private readonly resultsFile: string,
    private readonly onRecord: () => void,
  ) {
    const settings = getClassificationSettings()
    const model = resolveModel(settings)
    if (!model) throw new Error('No model configured for classification (classify.model or summary.model)')
    this.client = createClassifyClient(model)
    this.apiKey = getVllmApiKey()
    this.formatSpec = { question: 'format', text: FORMAT_QUESTION, options: toOptions(FORMATS), theta: settings.formatTheta }
    this.themeSpec = { question: 'theme', text: THEME_QUESTION, options: toOptions(settings.themes), theta: settings.themeTheta }
  }

  private save(r: BenchRecord): void {
    fs.appendFileSync(this.resultsFile, JSON.stringify(r) + '\n')
    this.results.set(r.key, r)
    this.onRecord()
  }

  private q(state: string, spec: QuestionSpec, options: Option[]): Question {
    return { state, question: spec.text, options, theta: spec.theta }
  }

  private async decide(articleId: number, reading: DecideRecord['reading'], state: string, spec: QuestionSpec): Promise<DecideRecord> {
    const key = recordKey(articleId, reading, spec.question)
    const done = this.results.get(key)
    if (done) return done as DecideRecord
    const options = reading === 'shuffled' ? permute(spec.options, hashSeed(this.cfg.seed, articleId, spec.question))
      : reading === 'rotation1' ? rotate(spec.options, 1)
      : reading === 'rotation2' ? rotate(spec.options, 2)
      : spec.options
    const d = await this.client.decide(this.q(state, spec, options))
    const rec = decideRecord(d, {
      key, articleId, reading, question: spec.question, questionText: spec.text,
      options: options.map(o => o.id), theta: spec.theta,
    })
    this.save(rec)
    return rec
  }

  /** Same prompt as production except the instruction line; thinking on, letter parsed from the text */
  private async reason(articleId: number, state: string, spec: QuestionSpec): Promise<void> {
    const key = recordKey(articleId, 'reasoned', spec.question)
    if (this.results.has(key)) return
    const r = this.cfg.reasoning
    const { params } = this.client.body({ ...this.q(state, spec, spec.options), instruction: r.instruction })
    const request: Record<string, unknown> = {
      ...params,
      max_tokens: r.maxTokens,
      temperature: r.temperature,
      chat_template_kwargs: { enable_thinking: true },
    }
    delete request.logprobs
    delete request.top_logprobs
    const t0 = Date.now()
    const resp = await postWithRetry(this.client.baseUrl + this.client.path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}) },
      body: JSON.stringify(request),
    }, r.timeoutMs)
    const ms = Date.now() - t0
    const choice0 = resp.choices?.[0]
    const content = choice0?.message?.content ?? ''
    const reasoning = choice0?.message?.reasoning_content ?? choice0?.message?.reasoning ?? null
    const finishReason = choice0?.finish_reason ?? null
    const letters = spec.options.map((_, i) => String.fromCharCode(65 + i))
    const letter = extractLetter(content, letters)
    const rec: ReasonedRecord = {
      key, articleId, reading: 'reasoned', question: spec.question, questionText: spec.text,
      options: spec.options.map(o => o.id), request, ms, at: new Date().toISOString(),
      status: letter ? 'ok' : finishReason === 'length' ? 'truncated' : 'unreadable',
      letter,
      choice: letter ? spec.options[letters.indexOf(letter)].id : null,
      content,
      reasoning,
      finishReason,
      usage: resp.usage ?? null,
    }
    this.save(rec)
  }

  /** The 9 calls of one article (11 with rotations); already-recorded calls are skipped */
  async runArticle(articleId: number): Promise<void> {
    const article = getArticleById(articleId)
    if (!article) throw new Error(`article ${articleId} not found in the snapshot`)
    // As queue.ts processClassify() builds the input
    const state = toWellFormedText(buildClassifyState({
      title: article.title,
      feedName: article.feed_name,
      body: article.full_text || article.excerpt || article.summary,
    }))

    const format = this.formatSpec
    const theme = this.themeSpec
    await this.decide(articleId, 'production', state, format)
    const prodTheme = await this.decide(articleId, 'production', state, theme)
    // As in production: the importance question carries the reader context of the theme just decided
    const prior = this.results.get(recordKey(articleId, 'production', 'importance'))
    const importance: QuestionSpec = {
      question: 'importance',
      text: prior?.questionText ?? buildImportanceQuestion(getReaderContext(prodTheme.choice)),
      options: toOptions(IMPORTANCE),
      theta: DEFAULT_IMPORTANCE_THETA,
    }
    await this.decide(articleId, 'production', state, importance)

    // Same questions, options permuted; the importance text is the production one
    for (const spec of [format, theme, importance]) await this.decide(articleId, 'shuffled', state, spec)
    // Importance in its two other option rotations (rotation 0 is the production call above),
    // with the production question text, so only the order of the options changes
    if (this.cfg.rotations) {
      for (const reading of ROTATION_READINGS) await this.decide(articleId, reading, state, importance)
    }
    for (const spec of [format, theme, importance]) await this.reason(articleId, state, spec)
  }
}
