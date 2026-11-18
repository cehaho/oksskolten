import { getDb } from '../db/connection.js'
import { NO_THEME_KEY } from '../../shared/journal.js'
import type {
  JournalContent,
  JournalEdition,
  JournalEditionSummary,
  JournalStatus,
} from '../../shared/journal.js'

/** The first edition has no previous one to start from: it looks back this far */
export const FIRST_EDITION_LOOKBACK = '-1 day'

/** A running edition older than this was cut short (restart, crash) */
const STALE_RUNNING_MINUTES = 30

/**
 * Feeds the journal never covers: clips, and starred GitHub releases read on
 * their own. A stars feed keeps its canonical URL in rss_url; url holds
 * whatever was pasted, `github.com/<user>?tab=stars` included.
 */
export const EXCLUDED_FEEDS_SQL = `f.type != 'clip'
  AND COALESCE(f.rss_url, '') NOT LIKE 'https://github.com/stars/%'
  AND f.url NOT LIKE 'https://github.com/stars/%'`

export interface JournalArticle {
  id: number
  title: string
  url: string
  theme: string | null
  feed_name: string
  published_at: string | null
  /** ESSENTIAL / USEFUL / SKIP; null when not judged or undecided */
  importance: string | null
  /** Summary, excerpt or start of the full text, whichever exists first */
  body: string
}

interface EditionRow {
  id: number
  created_at: string
  period_start: string | null
  period_end: string
  status: JournalStatus
  error: string | null
  article_count: number
  sections_done: number
  sections_total: number
  content: string | null
}

/** End of the newest finished edition: where the next one starts */
export function getLastPeriodEnd(): string | null {
  const row = getDb().prepare(
    "SELECT period_end FROM journal_editions WHERE status = 'done' ORDER BY id DESC LIMIT 1",
  ).get() as { period_end: string } | undefined
  return row?.period_end ?? null
}

/**
 * Articles published this long before the period starts are left out even
 * when they arrive in it: a newly added feed brings its whole backlog, years
 * old, in one fetch. The slack still covers feeds that publish late.
 */
export const MAX_PUBLISHED_BEFORE_PERIOD = '-7 days'

/** SQL for the period start, and its parameters. A null start looks back FIRST_EDITION_LOOKBACK from the end. */
function periodStart(start: string | null, end: string): { sql: string; params: string[] } {
  return start === null
    ? { sql: 'datetime(?, ?)', params: [end, FIRST_EDITION_LOOKBACK] }
    : { sql: '?', params: [start] }
}

function periodWhere(start: string | null): string {
  const from = periodStart(start, '').sql
  // Undated articles (or dates SQLite cannot parse) stay in: arrival is all we know
  return `a.created_at > ${from} AND a.created_at <= ?
    AND (a.published_at IS NULL OR datetime(a.published_at) IS NULL
         OR datetime(a.published_at) >= datetime(${from}, ?))`
}

function periodParams(start: string | null, end: string): string[] {
  const from = periodStart(start, end).params
  return [...from, end, ...from, MAX_PUBLISHED_BEFORE_PERIOD]
}

/** Articles arrived in (start, end], best first. A null start looks back FIRST_EDITION_LOOKBACK. */
export function getArticlesForPeriod(start: string | null, end: string): JournalArticle[] {
  return getDb().prepare(`
    SELECT a.id, a.title, a.url, a.theme, a.importance, a.published_at, f.name AS feed_name,
           COALESCE(NULLIF(a.summary, ''), NULLIF(a.excerpt, ''), substr(COALESCE(a.full_text, ''), 1, 600)) AS body
    FROM active_articles a
    JOIN feeds f ON f.id = a.feed_id
    WHERE ${periodWhere(start)} AND a.filtered_at IS NULL AND ${EXCLUDED_FEEDS_SQL}
    ORDER BY CASE a.importance WHEN 'ESSENTIAL' THEN 0 WHEN 'SKIP' THEN 2 ELSE 1 END,
             a.interest_score DESC, a.score DESC, a.id DESC
  `).all(...periodParams(start, end)) as JournalArticle[]
}

/** How many articles the next edition would cover if generated now */
export function countPendingArticles(): number {
  const start = getLastPeriodEnd()
  const row = getDb().prepare(`
    SELECT COUNT(*) AS n FROM active_articles a JOIN feeds f ON f.id = a.feed_id
    WHERE ${periodWhere(start)} AND a.filtered_at IS NULL AND ${EXCLUDED_FEEDS_SQL}
  `).get(...periodParams(start, nowSql())) as { n: number }
  return row.n
}

/** Current time in SQLite's datetime() format, so it compares with created_at */
export function nowSql(): string {
  return (getDb().prepare("SELECT datetime('now') AS now").get() as { now: string }).now
}

/** Mark editions stuck in 'running' (the process died mid-generation) as failed */
export function failStaleEditions(): void {
  getDb().prepare(`
    UPDATE journal_editions SET status = 'error', error = 'interrupted', finished_at = datetime('now')
    WHERE status = 'running' AND created_at < datetime('now', ?)
  `).run(`-${STALE_RUNNING_MINUTES} minutes`)
}

export function getRunningEdition(): { id: number } | undefined {
  return getDb().prepare(
    "SELECT id FROM journal_editions WHERE status = 'running' ORDER BY id DESC LIMIT 1",
  ).get() as { id: number } | undefined
}

export function createEdition(input: { periodStart: string | null; periodEnd: string; articleCount: number; sectionsTotal: number }): number {
  const result = getDb().prepare(`
    INSERT INTO journal_editions (period_start, period_end, article_count, sections_total)
    VALUES (?, ?, ?, ?)
  `).run(input.periodStart, input.periodEnd, input.articleCount, input.sectionsTotal)
  return Number(result.lastInsertRowid)
}

export function setSectionsDone(id: number, done: number): void {
  getDb().prepare('UPDATE journal_editions SET sections_done = ? WHERE id = ?').run(done, id)
}

export function finishEdition(id: number, content: JournalContent): void {
  getDb().prepare(`
    UPDATE journal_editions SET status = 'done', content = ?, finished_at = datetime('now')
    WHERE id = ?
  `).run(JSON.stringify(content), id)
}

export function failEdition(id: number, error: string): void {
  getDb().prepare(`
    UPDATE journal_editions SET status = 'error', error = ?, finished_at = datetime('now')
    WHERE id = ?
  `).run(error.slice(0, 500), id)
}

const NUMBER_SQL = `CASE WHEN status = 'done' THEN
  (SELECT COUNT(*) FROM journal_editions d WHERE d.status = 'done' AND d.id <= journal_editions.id)
  END AS number`

function toEdition(row: EditionRow & { number: number | null }): JournalEdition {
  let content: JournalContent | null = null
  if (row.content) {
    try { content = JSON.parse(row.content) as JournalContent } catch { content = null }
  }
  return { ...row, content }
}

export function getEdition(id: number): JournalEdition | null {
  const row = getDb().prepare(`SELECT *, ${NUMBER_SQL} FROM journal_editions WHERE id = ?`).get(id) as
    (EditionRow & { number: number | null }) | undefined
  return row ? toEdition(row) : null
}

export function getLatestEdition(): JournalEdition | null {
  const row = getDb().prepare(`SELECT *, ${NUMBER_SQL} FROM journal_editions ORDER BY id DESC LIMIT 1`).get() as
    (EditionRow & { number: number | null }) | undefined
  return row ? toEdition(row) : null
}

/** Finished editions, newest first */
export function listEditions(limit = 50): JournalEditionSummary[] {
  return getDb().prepare(`
    SELECT id, created_at, period_start, period_end, status, article_count, ${NUMBER_SQL}
    FROM journal_editions WHERE status = 'done' ORDER BY id DESC LIMIT ?
  `).all(limit) as JournalEditionSummary[]
}

// --- Instructions and feedback ---

export function getInstructions(): Record<string, string> {
  const rows = getDb().prepare('SELECT theme, instruction FROM journal_instructions').all() as { theme: string; instruction: string }[]
  return Object.fromEntries(rows.map(r => [r.theme, r.instruction]))
}

export function setInstruction(theme: string, instruction: string): void {
  const text = instruction.trim()
  if (!text) {
    getDb().prepare('DELETE FROM journal_instructions WHERE theme = ?').run(theme)
    return
  }
  getDb().prepare(`
    INSERT INTO journal_instructions (theme, instruction, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(theme) DO UPDATE SET instruction = excluded.instruction, updated_at = excluded.updated_at
  `).run(theme, text)
}

/** Record a vote; 0 clears it. Returns false when the article does not exist. */
export function setFeedback(articleId: number, vote: -1 | 0 | 1): boolean {
  if (vote === 0) {
    getDb().prepare('DELETE FROM journal_feedback WHERE article_id = ?').run(articleId)
    return true
  }
  const article = getDb().prepare('SELECT title, theme FROM active_articles WHERE id = ?').get(articleId) as
    { title: string; theme: string | null } | undefined
  if (!article) return false
  getDb().prepare(`
    INSERT INTO journal_feedback (article_id, vote, theme, title, created_at) VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(article_id) DO UPDATE SET vote = excluded.vote, created_at = excluded.created_at
  `).run(articleId, vote, article.theme, article.title)
  return true
}

/** Votes on the given articles, keyed by article id */
export function getFeedbackFor(articleIds: number[]): Record<number, number> {
  if (articleIds.length === 0) return {}
  const placeholders = articleIds.map(() => '?').join(',')
  const rows = getDb().prepare(
    `SELECT article_id, vote FROM journal_feedback WHERE article_id IN (${placeholders})`,
  ).all(...articleIds) as { article_id: number; vote: number }[]
  return Object.fromEntries(rows.map(r => [r.article_id, r.vote]))
}

/** Recent vote examples for one theme, shown to the model */
export function getFeedbackExamples(theme: string | null, limit = 10): { liked: string[]; disliked: string[] } {
  const rows = getDb().prepare(`
    SELECT vote, title FROM journal_feedback
    WHERE COALESCE(theme, '') = COALESCE(?, '')
    ORDER BY created_at DESC LIMIT ?
  `).all(theme, limit * 2) as { vote: number; title: string }[]
  return {
    liked: rows.filter(r => r.vote > 0).slice(0, limit).map(r => r.title),
    disliked: rows.filter(r => r.vote < 0).slice(0, limit).map(r => r.title),
  }
}

/** Votes shown per side when judging one article's importance at classification time */
const READER_CONTEXT_EXAMPLES = 5

/** The reader's instruction and recent votes for a theme, for the importance question */
export function getReaderContext(theme: string | null): { instruction?: string; liked: string[]; disliked: string[] } {
  // The journal files undecided and OTHER articles under one bucket, and keys its instruction so
  const key = theme && theme !== 'OTHER' ? theme : NO_THEME_KEY
  const instruction = getDb().prepare('SELECT instruction FROM journal_instructions WHERE theme = ?')
    .get(key) as { instruction: string } | undefined
  return { instruction: instruction?.instruction, ...getFeedbackExamples(theme, READER_CONTEXT_EXAMPLES) }
}
