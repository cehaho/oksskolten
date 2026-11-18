/**
 * Quality audit of a journal edition: important articles the edition left
 * out, and citations whose sentence does not match the cited article.
 * Pure functions; the data comes from journal-audit-db.ts.
 */
import type { JournalContent } from '../../shared/journal.js'
import { STOPWORDS } from './stopwords.js'

export interface AuditArticle {
  id: number
  title: string
  url: string
  feed_name: string
  importance: string | null
  interest_score: number
  /** Title, summary, excerpt and start of the full text */
  text: string
}

/** Why an article of the period is missing from the edition's text */
export type MissReason =
  | 'skipped'       // judged SKIP at classification, never sent to the model
  | 'overflow'      // past the per-section cap, never read by the model
  | 'uncited'       // read by the model, not cited
  | 'filtered'      // removed by a filter rule, never in the edition
  | 'too-old'       // published long before the period
  | 'excluded-feed' // clip or starred-releases feed

export interface MissedArticle {
  article: AuditArticle
  section: string | null
  reason: MissReason
}

export interface SuspectCitation {
  section: string
  n: number
  source_title: string
  /** The text the citation closes */
  excerpt: string
  /** Distinctive terms of the excerpt, none of which the cited article contains */
  terms: string[]
}

export interface SectionStats {
  label: string
  article_count: number
  cited: number
  uncited: number
  overflow: number
  skipped: number
}

export interface JournalAudit {
  edition_id: number
  article_count: number
  cited_count: number
  interest_threshold: number
  sections: SectionStats[]
  missed: MissedArticle[]
  suspects: SuspectCitation[]
}

/** Lowercase, accents folded */
export function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

const FOLDED_STOPWORDS = new Set([...STOPWORDS].map(normalize))

/**
 * Terms that name what a passage is about: capitalized words and words with
 * digits (product names, versions). Plain numbers are left out, their
 * formatting differs too much between a summary and its source.
 */
export function keyTerms(text: string): string[] {
  const terms: string[] = []
  for (const raw of text.split(/[^\p{L}\p{N}.\-]+/u)) {
    const word = raw.replace(/^[.\-]+|[.\-]+$/g, '')
    if (!word || /^[\d.\-]+$/.test(word)) continue
    const named = /^\p{Lu}/u.test(word) || /\d/.test(word)
    if (!named || word.length < 3) continue
    const term = normalize(word)
    if (FOLDED_STOPWORDS.has(term) || terms.includes(term)) continue
    terms.push(term)
  }
  return terms
}

/** Whether a term, or one of its long enough parts, occurs in normalized text */
function termFound(term: string, haystack: string): boolean {
  if (haystack.includes(term)) return true
  return term.split(/[.\-]/).some(part => part.length >= 4 && haystack.includes(part))
}

/** The summary cut at each run of citations: each piece with the numbers that close it */
export function citedSegments(summary: string): { text: string; refs: number[] }[] {
  const segments: { text: string; refs: number[] }[] = []
  const re = /((?:\[\d+\]\s*)+)/g
  let last = 0
  for (const match of summary.matchAll(re)) {
    const text = summary.slice(last, match.index).trim()
    const refs = [...match[1].matchAll(/\d+/g)].map(m => Number(m[0]))
    last = match.index + match[0].length
    // A citation run right after another (". [3]") closes the same passage
    if (!text.replace(/^[.,;:\s]+/, '') && segments.length) {
      segments[segments.length - 1].refs.push(...refs)
    } else {
      segments.push({ text: text.replace(/^[.,;:\s]+/, ''), refs })
    }
  }
  return segments
}

export function findSuspectCitations(content: JournalContent, articles: Map<number, AuditArticle>): SuspectCitation[] {
  const sourceByN = new Map(content.sources.map(s => [s.n, s]))
  const suspects: SuspectCitation[] = []
  const passages = [
    ...content.sections.map(s => ({ label: s.label, text: s.summary })),
    ...content.essentials.map(e => ({ label: 'Essentials', text: `${e.text}${e.refs.map(n => `[${n}]`).join('')}` })),
  ]
  for (const passage of passages) {
    for (const segment of citedSegments(passage.text)) {
      const terms = keyTerms(segment.text)
      if (terms.length === 0) continue
      for (const n of segment.refs) {
        const source = sourceByN.get(n)
        if (!source) continue
        const article = articles.get(source.article_id)
        const haystack = normalize(article?.text ?? source.title)
        if (terms.some(t => termFound(t, haystack))) continue
        suspects.push({ section: passage.label, n, source_title: source.title, excerpt: segment.text, terms })
      }
    }
  }
  return suspects
}

/** Interest score reached by the top tenth of the articles, 0 when scores are not used */
export function topInterestThreshold(articles: AuditArticle[], share = 0.1): number {
  const scores = articles.map(a => a.interest_score).filter(s => s > 0).sort((a, b) => b - a)
  if (scores.length === 0) return Infinity
  return scores[Math.max(0, Math.ceil(scores.length * share) - 1)]
}

export function isImportant(article: AuditArticle, threshold: number): boolean {
  return article.importance === 'ESSENTIAL' || article.interest_score >= threshold
}

export function auditEdition(input: {
  editionId: number
  content: JournalContent
  /** Every article the edition covered */
  articles: AuditArticle[]
  /** Articles that arrived in the period but were kept out of the edition */
  outOfScope: { article: AuditArticle; reason: 'filtered' | 'too-old' | 'excluded-feed' }[]
}): JournalAudit {
  const { content } = input
  const byId = new Map(input.articles.map(a => [a.id, a]))
  const cited = new Set(content.sources.map(s => s.article_id))
  const threshold = topInterestThreshold(input.articles)
  const missed: MissedArticle[] = []

  const sections = content.sections.map(section => {
    const lists: [MissReason, { article_id: number }[]][] = [
      ['skipped', section.skipped ?? []],
      ['overflow', section.overflow ?? []],
      ['uncited', section.uncited],
    ]
    for (const [reason, refs] of lists) {
      for (const ref of refs) {
        const article = byId.get(ref.article_id)
        if (article && !cited.has(article.id) && isImportant(article, threshold)) {
          missed.push({ article, section: section.label, reason })
        }
      }
    }
    return {
      label: section.label,
      article_count: section.article_count,
      cited: section.article_ids.filter(id => cited.has(id)).length,
      uncited: section.uncited.length,
      overflow: section.overflow?.length ?? 0,
      skipped: section.skipped?.length ?? 0,
    }
  })

  for (const { article, reason } of input.outOfScope) {
    if (isImportant(article, threshold)) missed.push({ article, section: null, reason })
  }
  missed.sort((a, b) =>
    Number(b.article.importance === 'ESSENTIAL') - Number(a.article.importance === 'ESSENTIAL')
    || b.article.interest_score - a.article.interest_score)

  return {
    edition_id: input.editionId,
    article_count: input.articles.length,
    cited_count: cited.size,
    interest_threshold: threshold,
    sections,
    missed,
    suspects: findSuspectCitations(content, byId),
  }
}

const REASON_LABELS: Record<MissReason, string> = {
  skipped: 'judged SKIP, not sent to the model',
  overflow: 'past the per-section cap, not read',
  uncited: 'read by the model, not cited',
  filtered: 'removed by a filter rule',
  'too-old': 'published too long before the period',
  'excluded-feed': 'feed excluded from the journal',
}

function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim()
}

export function formatAuditReport(audit: JournalAudit): string {
  const lines: string[] = [
    `# Journal audit: edition ${audit.edition_id}`,
    '',
    `- Articles covered: ${audit.article_count}`,
    `- Articles cited: ${audit.cited_count} (${audit.article_count ? Math.round(100 * audit.cited_count / audit.article_count) : 0}%)`,
    `- "Important" means importance ESSENTIAL${Number.isFinite(audit.interest_threshold) ? `, or interest score >= ${audit.interest_threshold.toFixed(3)} (top 10%)` : ''}`,
    `- Important articles missing: ${audit.missed.length}`,
    `- Suspect citations: ${audit.suspects.length}`,
    '',
    '## Sections',
    '',
    '| Section | Articles | Cited | Uncited | Over cap | Skipped |',
    '|---|---:|---:|---:|---:|---:|',
    ...audit.sections.map(s => `| ${cell(s.label)} | ${s.article_count} | ${s.cited} | ${s.uncited} | ${s.overflow} | ${s.skipped} |`),
    '',
    '## Important articles missing',
    '',
  ]
  if (audit.missed.length === 0) lines.push('None.')
  else {
    lines.push('| Article | Feed | Section | Importance | Interest | Why |', '|---|---|---|---|---:|---|')
    for (const m of audit.missed) {
      lines.push(`| [${cell(m.article.title)}](${m.article.url}) | ${cell(m.article.feed_name)} | ${cell(m.section ?? '(not in edition)')} | ${m.article.importance ?? '-'} | ${m.article.interest_score.toFixed(3)} | ${REASON_LABELS[m.reason]} |`)
    }
  }
  lines.push('', '## Suspect citations', '', 'The passage names terms that the cited article never mentions.', '')
  if (audit.suspects.length === 0) lines.push('None.')
  else {
    for (const s of audit.suspects) {
      lines.push(`- **${cell(s.section)} [${s.n}]** "${cell(s.excerpt)}"`)
      lines.push(`  - cites: ${cell(s.source_title)}`)
      lines.push(`  - terms not found: ${s.terms.join(', ')}`)
    }
  }
  return lines.join('\n') + '\n'
}
