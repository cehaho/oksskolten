import { describe, it, expect } from 'vitest'
import { auditEdition, citedSegments, formatAuditReport, keyTerms } from './journal-audit.js'
import type { AuditArticle } from './journal-audit.js'
import type { JournalContent } from '../../shared/journal.js'

function article(id: number, title: string, extra: Partial<AuditArticle> = {}): AuditArticle {
  return { id, title, url: `https://x.example/${id}`, feed_name: 'Feed', importance: null, interest_score: 0, text: title, ...extra }
}

describe('keyTerms', () => {
  it('keeps capitalized and versioned words, drops stopwords and plain numbers', () => {
    expect(keyTerms('Moonshot AI a publié les poids de Kimi K3.1 Pro, un modèle de 2 800 milliards. Sur le front')).toEqual(['moonshot', 'kimi', 'k3.1', 'pro'])
  })
})

describe('citedSegments', () => {
  it('cuts the summary at each citation run', () => {
    expect(citedSegments('A dit X [1], tandis que B [2][3]. Enfin C [4] [5].')).toEqual([
      { text: 'A dit X', refs: [1] },
      { text: 'tandis que B', refs: [2, 3] },
      { text: 'Enfin C', refs: [4, 5] },
    ])
  })
})

describe('auditEdition', () => {
  const articles = [
    article(1, 'Anthropic : 900 milliards de dollars pour combien de mois d\'avance ?'),
    article(2, 'Alibaba Qwen4-Max : 2 400 milliards de paramètres'),
    article(3, 'Moonshot sort Kimi K3.1 Pro', { importance: 'ESSENTIAL' }),
    article(4, 'Une note mineure', { importance: 'SKIP', interest_score: 0.9 }),
    article(5, 'Un article lu', { interest_score: 0.1 }),
  ]
  const content: JournalContent = {
    essentials: [],
    sources: [
      { n: 1, article_id: 1, title: articles[0].title, url: articles[0].url, feed_name: 'Feed', published_at: null },
      { n: 2, article_id: 2, title: articles[1].title, url: articles[1].url, feed_name: 'Feed', published_at: null },
    ],
    sections: [{
      theme: 'AI',
      label: 'IA',
      summary: 'Moonshot AI a publié les poids de Kimi K3.1 Pro [1], tandis qu\'Alibaba a annoncé Qwen4-Max [2].',
      article_count: 5,
      refs: [1, 2],
      article_ids: [1, 2, 3, 4, 5],
      uncited: [3, 5].map(id => ({ article_id: id, title: '', url: '', feed_name: '' })),
      overflow: [],
      skipped: [{ article_id: 4, title: '', url: '', feed_name: '' }],
    }],
  }
  const audit = auditEdition({
    editionId: 7,
    content,
    articles,
    outOfScope: [{ article: article(9, 'Filtré', { importance: 'ESSENTIAL' }), reason: 'filtered' }],
  })

  it('flags a citation whose passage names terms absent from the article', () => {
    expect(audit.suspects).toHaveLength(1)
    expect(audit.suspects[0]).toMatchObject({ n: 1, terms: ['moonshot', 'kimi', 'k3.1', 'pro'] })
  })

  it('lists important articles left out, with the reason', () => {
    expect(audit.missed.map(m => [m.article.id, m.reason])).toEqual([[3, 'uncited'], [9, 'filtered'], [4, 'skipped']])
  })

  it('counts cited articles per section and renders a report', () => {
    expect(audit.sections[0]).toMatchObject({ cited: 2, uncited: 2, skipped: 1 })
    expect(formatAuditReport(audit)).toContain('Suspect citations: 1')
  })
})
