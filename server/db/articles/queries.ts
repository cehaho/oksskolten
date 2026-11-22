import { getDb, getNamed, allNamed } from '../connection.js'
import type { ArticleListItem, ArticleDetail } from '../types.js'
import { normalizeUrl, scoreExpr } from './scoring.js'

// --- Article list queries ---

export function getArticles(opts: {
  feedId?: number
  categoryId?: number
  format?: string
  theme?: string
  unread?: boolean
  bookmarked?: boolean
  liked?: boolean
  read?: boolean
  sort?: 'score' | 'recommended'
  limit: number
  offset: number
  smartFloor?: boolean
}): { articles: ArticleListItem[]; total: number; totalWithoutFloor?: number } {
  // Articles rejected by a feed's AI filter keep their row but stay out of view
  const conditions: string[] = ['a.filtered_at IS NULL']
  const params: Record<string, unknown> = {}

  if (opts.feedId) {
    conditions.push('a.feed_id = @feedId')
    params.feedId = opts.feedId
  }
  if (opts.categoryId) {
    conditions.push('a.category_id = @categoryId')
    params.categoryId = opts.categoryId
  }
  if (opts.format) {
    conditions.push('a.format = @format')
    params.format = opts.format
  }
  if (opts.theme) {
    conditions.push('a.theme = @theme')
    params.theme = opts.theme
  }
  if (opts.unread) {
    conditions.push('a.seen_at IS NULL')
  }
  if (opts.bookmarked) {
    conditions.push('a.bookmarked_at IS NOT NULL')
  }
  if (opts.liked) {
    conditions.push('a.liked_at IS NOT NULL')
  }
  if (opts.read) {
    conditions.push('a.read_at IS NOT NULL')
  }

  // Smart floor: limit the displayed range to keep lists manageable.
  // Pick the floor that yields the MOST articles (= earliest date) among:
  //   1. SMART_FLOOR_DAYS ago
  //   2. SMART_FLOOR_MIN_ARTICLES-th newest article's date
  //   3. Oldest unread article's date (if any)
  const SMART_FLOOR_DAYS = 7
  const SMART_FLOOR_MIN_ARTICLES = 20

  let floorApplied = false

  if (opts.smartFloor) {
    const scopeWhere = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : ''

    // Candidate 1: SMART_FLOOR_DAYS ago
    const floorAgo = new Date(Date.now() - SMART_FLOOR_DAYS * 24 * 60 * 60 * 1000).toISOString()

    // Candidate 2: SMART_FLOOR_MIN_ARTICLES-th newest article's date
    const top20Row = getNamed<{ floor: string | null }>(`
      SELECT a.published_at AS floor FROM active_articles a
      ${scopeWhere}
      ORDER BY a.published_at DESC
      LIMIT 1 OFFSET ${SMART_FLOOR_MIN_ARTICLES - 1}
    `, params)

    // Candidate 3: oldest unread article's date
    const unreadRow = getNamed<{ floor: string | null }>(`
      SELECT MIN(a.published_at) AS floor FROM active_articles a
      ${scopeWhere ? scopeWhere + ' AND' : 'WHERE'} a.seen_at IS NULL AND a.published_at IS NOT NULL
    `, params)

    // If fewer than SMART_FLOOR_MIN_ARTICLES exist, skip the floor entirely — show all
    if (!top20Row?.floor) {
      // no-op: don't add a date condition
    } else {
      // Pick the earliest (= shows the most articles)
      const candidates: string[] = [floorAgo, top20Row.floor]
      if (unreadRow?.floor) candidates.push(unreadRow.floor)
      const smartFloorDate = candidates.sort()[0]

      conditions.push('(a.published_at IS NULL OR a.published_at >= @smartFloorDate)')
      params.smartFloorDate = smartFloorDate
      floorApplied = true
    }
  }

  // Count without floor for "show more" UI
  const baseWhere = floorApplied
    ? (() => {
        const baseConditions = conditions.filter(c => !c.includes('@smartFloorDate'))
        return baseConditions.length > 0 ? 'WHERE ' + baseConditions.join(' AND ') : ''
      })()
    : undefined

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : ''
  const orderBy = opts.sort === 'score'
    ? 'a.score DESC, a.published_at DESC'
    : opts.sort === 'recommended'
      // Interest profile first, then source trust and quality as tie-breakers
      ? 'a.interest_score DESC, (f.trust_score + COALESCE(a.quality_score, 0.5)) DESC, a.published_at DESC'
      : opts.liked ? 'a.liked_at DESC' : opts.read ? 'a.read_at DESC' : 'a.published_at DESC'

  const totalRow = getNamed<{ cnt: number }>(`
    SELECT COUNT(*) AS cnt FROM active_articles a ${where}
  `, params)
  const total = totalRow.cnt

  const totalWithoutFloor = baseWhere != null
    ? getNamed<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM active_articles a ${baseWhere}`, params).cnt
    : undefined

  const articles = allNamed<ArticleListItem>(`
    SELECT a.id, a.feed_id, f.name AS feed_name,
           a.title, a.title_translated, a.url, a.published_at, a.lang, a.summary, a.excerpt, a.og_image, a.seen_at, a.read_at, a.bookmarked_at, a.liked_at,
           a.score, a.interest_score, a.quality_score, a.format, a.theme,
           (SELECT COUNT(*) FROM article_similarities WHERE article_id = a.id) AS similar_count,
           (SELECT GROUP_CONCAT(similar_to_id) FROM article_similarities WHERE article_id = a.id) AS similar_ids
    FROM active_articles a
    JOIN feeds f ON a.feed_id = f.id
    ${where}
    ORDER BY ${orderBy}
    LIMIT @_limit OFFSET @_offset
  `, { ...params, _limit: Number(opts.limit), _offset: Number(opts.offset) })

  return { articles, total, ...(totalWithoutFloor != null && totalWithoutFloor > total ? { totalWithoutFloor } : {}) }
}

export function getArticleByUrl(url: string): ArticleDetail | undefined {
  const db = getDb()
  const normalized = normalizeUrl(url)
  const stmt = db.prepare(`
    SELECT a.id, a.feed_id, f.name AS feed_name, f.type AS feed_type,
           a.title, a.title_translated, a.url, a.published_at, a.lang, a.summary, a.excerpt, a.og_image,
           a.full_text, a.full_text_translated, a.translated_lang, a.seen_at, a.read_at, a.bookmarked_at, a.liked_at,
           a.images_archived_at, a.videos_archived_at, a.last_error,
           (SELECT COUNT(*) FROM article_similarities WHERE article_id = a.id) AS similar_count
    FROM active_articles a
    JOIN feeds f ON a.feed_id = f.id
    WHERE a.url = ?
  `)

  // Candidate forms: WHATWG-normalized (percent-encodes non-ASCII), the raw
  // input, and the fully decoded form — feeds store either encoding, and the
  // reader route decodes percent-escapes on its round-trip.
  const forms = [normalized, url]
  try {
    forms.push(decodeURI(normalized))
  } catch { /* malformed percent-escapes — skip the decoded form */ }

  // Protocol fallback: handle articles stored under one protocol when the
  // request arrives with the other. This covers the transition period where
  // some articles were saved before http:// feed registration was allowed.
  const swapProtocol = (u: string): string | null => {
    if (u.startsWith('https://')) return 'http://' + u.slice(8)
    if (u.startsWith('http://')) return 'https://' + u.slice(7)
    return null
  }

  const candidates: string[] = []
  for (const form of forms) {
    for (const variant of [form, swapProtocol(form)]) {
      if (variant && !candidates.includes(variant)) candidates.push(variant)
    }
  }

  for (const candidate of candidates) {
    const article = stmt.get(candidate) as ArticleDetail | undefined
    if (article) return article
  }

  return undefined
}

export function getArticleById(id: number): ArticleDetail | undefined {
  return getDb().prepare(`
    SELECT a.id, a.feed_id, f.name AS feed_name, f.type AS feed_type,
           a.title, a.title_translated, a.url, a.published_at, a.lang, a.summary, a.excerpt, a.og_image,
           a.full_text, a.full_text_translated, a.translated_lang, a.seen_at, a.read_at, a.bookmarked_at, a.liked_at,
           a.images_archived_at, a.videos_archived_at, a.filtered_at, a.format, a.theme, a.last_error,
           (SELECT COUNT(*) FROM article_similarities WHERE article_id = a.id) AS similar_count
    FROM active_articles a
    JOIN feeds f ON a.feed_id = f.id
    WHERE a.id = ?
  `).get(id) as ArticleDetail | undefined
}

// --- Search by IDs (Meilisearch integration) ---

export function getArticlesByIds(
  ids: number[],
  opts?: { unread?: boolean; liked?: boolean; bookmarked?: boolean },
): ArticleListItem[] {
  if (ids.length === 0) return []
  const placeholders = ids.map(() => '?').join(',')
  const orderCase = ids.map((id, i) => `WHEN ${id} THEN ${i}`).join(' ')

  const conditions: string[] = [`a.id IN (${placeholders})`]
  if (opts?.unread !== undefined) {
    conditions.push(opts.unread ? 'a.seen_at IS NULL' : 'a.seen_at IS NOT NULL')
  }
  if (opts?.liked) conditions.push('a.liked_at IS NOT NULL')
  if (opts?.bookmarked) conditions.push('a.bookmarked_at IS NOT NULL')

  const where = 'WHERE ' + conditions.join(' AND ')
  const score = scoreExpr('a.')

  return getDb().prepare(`
    SELECT a.id, a.feed_id, f.name AS feed_name,
           a.title, a.url, a.published_at, a.lang, a.summary, a.excerpt,
           a.og_image, a.seen_at, a.read_at, a.bookmarked_at, a.liked_at,
           ${score} AS score
    FROM active_articles a
    JOIN feeds f ON a.feed_id = f.id
    ${where}
    ORDER BY CASE a.id ${orderCase} END
  `).all(...ids) as ArticleListItem[]
}

// --- Search queries ---

export function searchArticles(opts: {
  query?: string
  feed_id?: number
  category_id?: number
  unread?: boolean
  bookmarked?: boolean
  liked?: boolean
  since?: string
  until?: string
  limit?: number
  sort?: 'published_at' | 'score'
}): ArticleListItem[] {
  const conditions: string[] = []
  const params: Record<string, unknown> = {}

  if (opts.feed_id) {
    conditions.push('a.feed_id = @feed_id')
    params.feed_id = opts.feed_id
  }
  if (opts.category_id) {
    conditions.push('a.category_id = @category_id')
    params.category_id = opts.category_id
  }
  if (opts.unread !== undefined) {
    conditions.push(opts.unread ? 'a.seen_at IS NULL' : 'a.seen_at IS NOT NULL')
  }
  if (opts.bookmarked) {
    conditions.push('a.bookmarked_at IS NOT NULL')
  }
  if (opts.liked) {
    conditions.push('a.liked_at IS NOT NULL')
  }
  if (opts.since) {
    conditions.push('a.published_at >= @since')
    params.since = opts.since
  }
  if (opts.until) {
    conditions.push('a.published_at <= @until')
    params.until = opts.until
  }

  const hasQuery = !!opts.query

  if (hasQuery) {
    const likePattern = `%${opts.query}%`
    conditions.push('(a.title LIKE @likeQuery OR a.full_text LIKE @likeQuery OR a.full_text_translated LIKE @likeQuery)')
    params.likeQuery = likePattern
  }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : ''
  const limit = opts.limit ?? 20
  const score = scoreExpr('a.', { searchBoost: hasQuery })

  let orderBy: string
  if (opts.sort === 'score') {
    orderBy = `${score} DESC, a.published_at DESC`
  } else if (opts.sort === 'published_at') {
    orderBy = 'a.published_at DESC'
  } else {
    orderBy = hasQuery ? `${score} DESC` : 'a.published_at DESC'
  }

  return allNamed<ArticleListItem>(`
    SELECT a.id, a.feed_id, f.name AS feed_name,
           a.title, a.title_translated, a.url, a.published_at, a.lang, a.summary, a.excerpt, a.og_image, a.seen_at, a.read_at, a.bookmarked_at, a.liked_at,
           ${score} AS score
    FROM active_articles a
    JOIN feeds f ON a.feed_id = f.id
    ${where}
    ORDER BY ${orderBy}
    LIMIT ${Number(limit)}
  `, params)
}
