// Shared type definitions for Feed, Category, Article and related types.
// Canonical source of truth — server/db.ts re-exports these.

export interface Category {
  id: number
  name: string
  sort_order: number
  collapsed: number
  created_at: string
}

export interface Feed {
  id: number
  name: string
  url: string
  rss_url: string | null
  rss_bridge_url: string | null
  category_id: number | null
  last_error: string | null
  error_count: number
  disabled: number
  requires_js_challenge: number
  type: 'rss' | 'clip'
  etag: string | null
  last_modified: string | null
  last_content_hash: string | null
  next_check_at: string | null
  check_interval: number | null
  /** Criterion for the per-feed AI relevance filter; absent or null disables it */
  ai_filter?: string | null
  /** 1 = archive article images automatically at fetch time (default 0: on open) */
  archive_images?: number
  /** Recent reading value of the source, 0..1 (see server/db/trust.ts) */
  trust_score?: number
  created_at: string
}

export interface FeedWithCounts extends Feed {
  category_name: string | null
  article_count: number
  unread_count: number
  articles_per_week: number
  latest_published_at: string | null
}

export interface Article {
  id: number
  feed_id: number
  title: string
  url: string
  published_at: string | null
  lang: string | null
  full_text: string | null
  full_text_translated: string | null
  translated_lang: string | null
  summary: string | null
  og_image: string | null
  last_error: string | null
  retry_count: number
  last_retry_at: string | null
  fetched_at: string
  seen_at: string | null
  read_at: string | null
  bookmarked_at: string | null
  liked_at: string | null
  created_at: string
}

export interface ArticleListItem {
  id: number
  feed_id: number
  feed_name: string
  title: string
  title_translated: string | null
  url: string
  published_at: string | null
  lang: string | null
  summary: string | null
  excerpt: string | null
  og_image: string | null
  seen_at: string | null
  read_at: string | null
  bookmarked_at: string | null
  liked_at: string | null
  score?: number
  /** Match against the interest profile; orders the Recommended list */
  interest_score?: number
  /** Heuristic quality 0..1, null before ingestion scored it */
  quality_score?: number | null
  similar_count?: number
  /** Comma-separated ids of similar articles (bidirectional pairs), list queries only */
  similar_ids?: string | null
  /** Classification (FORMATS id / theme id); null when not classified or undecided */
  format?: string | null
  theme?: string | null
}

export interface ArticleDetail extends ArticleListItem {
  full_text: string | null
  full_text_translated: string | null
  translated_lang: string | null
  images_archived_at: string | null
  videos_archived_at: string | null
  feed_type: 'rss' | 'clip'
  imageArchivingEnabled: boolean
  videoArchivingEnabled: boolean
  /** Set when the feed's AI filter rejected the article; it stays hidden from lists */
  filtered_at?: string | null
  /** Last content-fetch error; `blocked:` prefix when the site served a bot-protection page */
  last_error?: string | null
}
