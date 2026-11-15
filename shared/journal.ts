/**
 * Journal: an on-demand, sourced digest of everything that arrived since the
 * previous edition, one synthesis per article theme. See
 * docs/spec/89_feature_journal.md.
 */

/** Theme key of the bucket holding articles without a theme */
export const NO_THEME_KEY = '_'

export type JournalStatus = 'running' | 'done' | 'error'

/** One cited article. `n` is its citation number, unique within an edition. */
export interface JournalSource {
  n: number
  article_id: number
  title: string
  url: string
  feed_name: string
  published_at: string | null
}

/** An article the section covered without citing it */
export interface JournalArticleRef {
  article_id: number
  title: string
  url: string
  feed_name: string
}

export interface JournalSection {
  /** Theme id, or NO_THEME_KEY */
  theme: string
  label: string
  /** Markdown paragraphs citing sources as [n] */
  summary: string
  article_count: number
  /** Citation numbers used by `summary`, in order of first use */
  refs: number[]
  /** Every article the section covered, cited or not */
  article_ids: number[]
  /** Read by the model but not cited, best first */
  uncited: JournalArticleRef[]
  /** Past the per-section cap: covered and counted, never read by the model. Absent in older editions. */
  overflow?: JournalArticleRef[]
  /** Judged negligible at classification time, never sent to the model. Absent in editions written before importance existed. */
  skipped?: JournalArticleRef[]
}

export interface JournalEssential {
  text: string
  theme: string
  refs: number[]
}

export interface JournalContent {
  essentials: JournalEssential[]
  sections: JournalSection[]
  sources: JournalSource[]
}

export interface JournalEditionSummary {
  id: number
  /** 1-based rank among finished editions; null while running or failed */
  number: number | null
  created_at: string
  period_start: string | null
  period_end: string
  status: JournalStatus
  article_count: number
}

export interface JournalEdition extends JournalEditionSummary {
  error: string | null
  sections_done: number
  sections_total: number
  content: JournalContent | null
}

export interface JournalOverview {
  /** The newest edition (running, done or failed), if any */
  latest: JournalEdition | null
  /** Articles that the next edition would cover */
  pending_count: number
  /** Reader instructions keyed by theme */
  instructions: Record<string, string>
  /** Votes keyed by article id: 1 more like this, -1 less */
  feedback: Record<number, number>
}
