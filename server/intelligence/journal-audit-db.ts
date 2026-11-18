/** Read-only queries feeding the journal audit (journal-audit.ts) */
import { getDb } from '../db/connection.js'
import { FIRST_EDITION_LOOKBACK, MAX_PUBLISHED_BEFORE_PERIOD } from './journal-db.js'
import type { AuditArticle } from './journal-audit.js'

const ARTICLE_COLUMNS = `a.id, a.title, a.url, f.name AS feed_name, a.importance, a.interest_score,
  a.title || ' ' || COALESCE(a.summary, '') || ' ' || COALESCE(a.excerpt, '') || ' ' || substr(COALESCE(a.full_text, ''), 1, 4000) AS text`

export function getAuditArticles(ids: number[]): AuditArticle[] {
  if (ids.length === 0) return []
  return getDb().prepare(`
    SELECT ${ARTICLE_COLUMNS} FROM active_articles a JOIN feeds f ON f.id = a.feed_id
    WHERE a.id IN (${ids.map(() => '?').join(',')})
  `).all(...ids) as AuditArticle[]
}

/** Articles that arrived in the period but that the journal kept out, with the reason */
export function getOutOfScopeArticles(
  periodStart: string | null, periodEnd: string, coveredIds: number[],
): { article: AuditArticle; reason: 'filtered' | 'too-old' | 'excluded-feed' }[] {
  const from = periodStart === null ? 'datetime(?, ?)' : '?'
  const fromParams = periodStart === null ? [periodEnd, FIRST_EDITION_LOOKBACK] : [periodStart]
  const covered = new Set(coveredIds)
  const rows = getDb().prepare(`
    SELECT ${ARTICLE_COLUMNS},
      CASE
        WHEN f.type = 'clip' OR COALESCE(f.rss_url, '') LIKE 'https://github.com/stars/%'
          OR f.url LIKE 'https://github.com/stars/%' THEN 'excluded-feed'
        WHEN a.filtered_at IS NOT NULL THEN 'filtered'
        WHEN datetime(a.published_at) < datetime(${from}, ?) THEN 'too-old'
      END AS reason
    FROM active_articles a JOIN feeds f ON f.id = a.feed_id
    WHERE a.created_at > ${from} AND a.created_at <= ?
  `).all(...fromParams, MAX_PUBLISHED_BEFORE_PERIOD, ...fromParams, periodEnd) as
    (AuditArticle & { reason: 'filtered' | 'too-old' | 'excluded-feed' | null })[]
  return rows
    .filter(r => r.reason !== null && !covered.has(r.id))
    .map(({ reason, ...article }) => ({ article, reason: reason! }))
}
