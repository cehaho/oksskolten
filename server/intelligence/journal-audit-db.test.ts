import { describe, it, expect, beforeEach } from 'vitest'
import { setupTestDb } from '../__tests__/helpers/testDb.js'
import { createFeed, insertArticle } from '../db.js'
import { getDb } from '../db/connection.js'
import { getAuditArticles, getOutOfScopeArticles } from './journal-audit-db.js'

beforeEach(() => setupTestDb())

describe('journal audit queries', () => {
  it('reads covered articles and finds those kept out of the period, with the reason', () => {
    const feed = createFeed({ name: 'Blog', url: 'https://blog.example.com' })
    const clips = createFeed({ name: 'Clips', url: 'https://clips.example.com', type: 'clip' })
    const now = new Date().toISOString()
    const kept = insertArticle({ feed_id: feed.id, title: 'Kept', url: 'https://blog.example.com/1', published_at: now })
    const filtered = insertArticle({ feed_id: feed.id, title: 'Filtered', url: 'https://blog.example.com/2', published_at: now })
    const old = insertArticle({ feed_id: feed.id, title: 'Old', url: 'https://blog.example.com/3', published_at: '2020-01-01T00:00:00Z' })
    const clip = insertArticle({ feed_id: clips.id, title: 'Clip', url: 'https://clips.example.com/1', published_at: now })
    getDb().prepare("UPDATE articles SET filtered_at = datetime('now') WHERE id = ?").run(filtered)
    const end = (getDb().prepare("SELECT datetime('now', '+1 minute') AS t").get() as { t: string }).t

    expect(getAuditArticles([kept]).map(a => a.title)).toEqual(['Kept'])
    const out = getOutOfScopeArticles(null, end, [kept])
    expect(Object.fromEntries(out.map(o => [o.article.id, o.reason]))).toEqual({
      [filtered]: 'filtered',
      [old]: 'too-old',
    })
    expect(out.map(o => o.article.id)).not.toContain(clip)
  })
})
