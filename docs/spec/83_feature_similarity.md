# Oksskolten Spec — Similar Article Detection

> [Back to Overview](./01_overview.md)

## Overview

Detect similar articles across different feeds and provide two behaviors:

1. **Similar article banner**: When viewing an article, show a notice listing other sources that covered the same story
2. **Auto-mark-read**: When a user has already read a similar article from another source, automatically mark the duplicate as `seen_at` (removes it from unread count)

## Motivation

Users subscribing to multiple feeds covering the same topics (e.g., tech news) see the same story reported by different sources repeatedly. This creates noise in the feed list.

## Design

### Detection Algorithm

**Two-stage: Meilisearch title search + Bigram Dice Coefficient + shared words**

1. After a new article is inserted, search Meilisearch using the article's title as query
2. Filter candidates: within ±3 days of `published_at`, OR with no `published_at` at all (see note below)
3. Exclude same-feed candidates (`feed_id != X`) in application code, except two Reddit posts of **different subreddits**: an aggregator feed (a Reddit multi) carries a crosspost and its original side by side, same title, same feed. Same subreddit stays excluded, so a thread posted daily under one title is not folded into its previous editions
4. Compute bigram Dice coefficient between the new article's title and each candidate's title
5. Keep candidates with score >= 0.4
6. Of those, accept only titles that share at least half of their significant words (word Dice >= 0.5, see below)

> `buildMeiliDoc()` indexes a missing `published_at` as `0` (1970) so Meilisearch's filterable attribute stays numeric. A plain ±3-day range filter would then permanently exclude every undated article from ever matching, since epoch 0 never falls inside a real window — the filter explicitly ORs in `published_at = 0` to let those candidates through.

```
Dice(A, B) = 2 × |bigrams(A) ∩ bigrams(B)| / (|bigrams(A)| + |bigrams(B)|)
```

Where `bigrams(s)` extracts character bigrams from each word after lowercasing and stripping punctuation. The threshold of 0.4 catches rephrased headlines ("Apple announces iPhone 17" vs "Apple unveils new iPhone 17").

Bigrams alone are not enough on long titles: the set of letter pairs saturates, and two unrelated French sentences share "es", "de", "ou", "re"… Two such titles with no word in common scored 0.42 and 0.41. The second check (`computeWordOverlap()`) therefore compares words: the same Dice formula over each title's significant words, which are lowercased with accents folded, split on anything that is not a letter or digit, stripped of English/French stopwords (`server/intelligence/stopwords.ts`, shared with the interest profile) and of four-digit years, and cut to their first 6 letters so inflections still meet ("annonce" / "annoncées"). Numbers are kept whatever their length. `titlesMatch()` requires both checks.

The word check stands aside, leaving bigrams to decide alone, when a title is written in a script without spaces (Han, Hiragana, Katakana, Thai), where a "word" would be a whole clause, or when a title has no significant word at all.

Titles built on the same template around a different subject can still pass ("Les nouveautés de Firefox 140" / "Les nouveautés de Chrome 140"): telling them apart would need word frequencies, which this check does not have.

### Re-checking stored links

`pruneStaleSimilarities()` runs at startup. When the `similarity.rule_version` setting differs from the rule version in `similarity.ts`, it re-checks every stored pair with `titlesMatch()`, deletes the rejected ones in both directions, then records the version, so the pass runs once per rule change. Articles already marked `seen_at` because of a rejected link stay seen: `seen_at` does not record why it was set.

No LLM or embedding costs — uses existing Meilisearch keyword search infrastructure.

### Storage

```sql
CREATE TABLE article_similarities (
  article_id    INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  similar_to_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  score         REAL NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (article_id, similar_to_id)
);

CREATE INDEX idx_similarities_similar_to ON article_similarities(similar_to_id);
```

- Bidirectional: if A is similar to B, both `(A, B)` and `(B, A)` are stored
- Lookups are always `WHERE article_id = ?` (single-direction query)
- `ON DELETE CASCADE` ensures cleanup when articles are deleted

### Detection Timing

Runs asynchronously (fire-and-forget) after `insertArticle()` in the fetcher pipeline:

```
insertArticle()
  → syncArticleToSearch()           [existing, fire-and-forget]
  → detectAndStoreSimilarArticles() [new, fire-and-forget]
      → Meilisearch title search (exclude same feed, ±3 day window)
      → Bigram Dice filter (>= 0.4) + shared-word filter (>= 0.5)
      → INSERT INTO article_similarities (bidirectional)
      → If similar article has read_at → markArticleSeen(new article)
```

Does not block the ingestion pipeline. Works even when `full_text` is null (title is always present).

### Auto-mark-read Logic

When a similar article is found that has `read_at IS NOT NULL`, the new article's `seen_at` is set to the current timestamp. `read_at` is **not** set — this distinction is intentional:

- `seen_at` removes the article from the unread count, reducing feed noise
- `read_at` is reserved for articles the user actually opened
- The user can still open the article to read a different source's perspective

### API

**GET /api/articles/:id/similar** — Get similar articles

```json
// Response: 200
{
  "similar": [
    {
      "id": 123,
      "feed_name": "TechCrunch",
      "title": "Apple announces iPhone 17",
      "url": "https://techcrunch.com/...",
      "published_at": "2026-03-18T10:00:00Z",
      "read_at": "2026-03-18T11:05:00Z",
      "score": 0.82
    }
  ]
}
```

Sorted by similarity score descending.

**Article list/detail responses** include `similar_count` (integer) computed via subquery:

```sql
(SELECT COUNT(*) FROM article_similarities WHERE article_id = a.id) AS similar_count
```

### Frontend

**Article detail view**: A collapsible banner appears below the summary section when `similar_count > 0`:

- "This story was also covered by {feedNames}" — or "You already read this from {feedName}" if a similar article has `read_at`
- Expandable `<details>` section listing each similar article with title, feed name, and read status
- Clicking a similar article navigates within the app (SPA navigation via `articleUrlToPath`)

**Article list**: A small `Layers` icon appears after the date in the article metadata row when `similar_count > 0`.

### Embedding server settings

Title matching misses two reports of the same news worded differently, or written in two languages. The next step compares embeddings (vectors standing for the meaning of a text) instead; for now only the settings and a connection test exist, and nothing computes or stores a vector.

Settings → AI & translation → Embeddings, stored in `settings`:

| Key | Default | Description |
|-----|---------|-------------|
| `embeddings.base_url` | empty | OpenAI-compatible server, with or without `/v1`; empty uses `vllm.base_url` |
| `api_key.embeddings` | empty | Bearer key; empty uses `api_key.vllm` |
| `embeddings.model` | empty | Model name on that server (e.g. `bge-m3`); empty turns embeddings off |
| `embeddings.dimensions` | `1024` | Expected vector size, an integer from 1 to 8192 |

The fallbacks let one llama-swap serve both the chat model and the embedding model without a second URL or key. `server/ai/providers/embeddings.ts` resolves them (`getEmbeddingsServer()`, `getEmbeddingsConfig()`, null without a model) and `embed(texts)` posts `{ model, input }` to `/v1/embeddings`, returning one vector per text in input order (rows are sorted by their `index`). It does not check the vector size; callers compare it with `dimensions` where a mismatch matters.

| Endpoint | Description |
|----------|-------------|
| `GET /api/settings/embeddings/models` | `/v1/models` of the embeddings server, for the model field's suggestions |
| `GET /api/settings/embeddings/status` | Embeds one short text with the saved settings: `{ ok, dimensions, expected, ms }`, or `{ ok: false, error }` (`EMBEDDINGS_NOT_CONFIGURED` without a model) |

The settings card flags a size mismatch from the test, since vectors of the wrong size could not be compared with stored ones.

### Key Files

| File | Purpose |
|------|---------|
| `migrations/0004_article_similarities.sql` | Schema |
| `server/intelligence/similarity-db.ts` | DB functions: insertSimilarity, getSimilarArticles, findReadSimilarArticle, getSimilarityPairs, deleteSimilarities |
| `server/intelligence/similarity.ts` | Detection logic: detectAndStoreSimilarArticles, computeTitleSimilarity, computeWordOverlap, titlesMatch, pruneStaleSimilarities |
| `server/intelligence/stopwords.ts` | English/French stopwords, shared with the interest profile |
| `server/fetcher.ts` | Hook: calls detectAndStoreSimilarArticles after insertArticle |
| `server/routes/articles.ts` | Endpoint: GET /api/articles/:id/similar |
| `server/db/articles.ts` | similar_count subquery in getArticles, getArticleByUrl, getArticleById |
| `src/components/article/article-similar-banner.tsx` | Frontend banner component |
| `server/ai/providers/embeddings.ts` | Embeddings server settings and `embed()` client |
