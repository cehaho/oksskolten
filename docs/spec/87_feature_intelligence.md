# Oksskolten Spec — Reading Intelligence

> [Back to Overview](./01_overview.md)

## Overview

Five features inspired by RSSMonster's "smart" layer, adapted to what Oksskolten already stores (full text, engagement, title similarity):

| Feature | What it does | Where |
|---|---|---|
| Smart folders | A saved query (`rust unread:true @week`) shown as a sidebar folder; new matches appear on their own | Sidebar → Smart folders, `/smart/:id` |
| Automated rules | Regular-expression rules applied to every new article: mark read, hide, bookmark, like, or change the score | Settings → Feeds → Automated rules |
| Top stories | Events covered by several sources, folded into one story and ranked by breadth of coverage | Sidebar → Top Stories, `/stories` |
| Feed trust and article quality | A per-feed 0..1 trust score from recent reading, and a per-article 0..1 heuristic quality score; both feed the front page ranking | Settings → Feeds table (Trust column) |
| Interest islands and Recommended | An interest profile learned from likes, bookmarks and opened articles, grouped into islands of co-occurring terms; unread articles ranked against it | Settings → General → Your interests, `/recommended` |

None of them call a model. Everything runs on SQLite and, for free-text smart folders, the existing Meilisearch index.

## Motivation

A reader following many feeds needs help beyond chronological lists: finding again what matches a standing interest, acting on predictable articles without opening them, seeing which events many sources cover, and knowing which feeds and articles tend to be worth the time. RSSMonster's "smart" layer answers these needs; this spec adapts it to what Oksskolten already stores, without calling a model.

## Design

### Smart folders

#### Query language

`shared/smart-query.ts` parses a query shared by the server and the client:

```
unread:true | unread:false        is:unread | is:read
bookmarked:true                   is:bookmarked
liked:true                        is:liked
feed:<id>   category:<id>
@today  @yesterday  @week  @month since:3d | since:2w | since:1m
sort:score | sort:date
```

Every other token, quoted phrases included, is free text. Unknown `key:value` tokens stay in the text rather than being dropped, so a typo is visible in the results instead of silently ignored. `@today` starts at local midnight, so an article published minutes ago is never hidden by the window.

#### Execution

`GET /api/smart-folders/:id/articles` (`server/db/smart-folders.ts`):

1. Free text with the search index ready: Meilisearch returns up to 500 candidate ids with the folder's filters applied, and SQL restricts to those ids, keeping the search ranking unless `sort:` says otherwise.
2. Otherwise (no free text, or index building or unreachable): SQL only. Free text falls back to `LIKE` on the title, translated title and body, every word required.

The sidebar badge (`unread_count`) is computed in SQL for filter-only folders and is `null` for free-text folders, which would need an index round trip per sidebar render.

#### Creation

Sidebar "+" opens `SmartFolderDialog`; the search dialog's footer offers "Save as smart folder", pre-filling the query from the current text, chips and period. Right-click a folder to edit or delete it. Articles are never deleted with a folder.

### Automated rules

`feed_rules` rows carry a scope (`feed_id`, `NULL` for every feed), a field (`title` | `url` | `content` | `any`), a pattern compiled with the `iu` flags, and an action:

| Action | Effect |
|---|---|
| `mark_read` | `seen_at` set (removed from unread, not counted as opened) |
| `hide` | `filtered_at` set: the same reversible marker the AI filter uses |
| `bookmark` / `like` | the corresponding timestamp set |
| `score` | `articles.rule_boost += value`; the boost is part of the engagement sum, so decay applies |

Rules run synchronously in `processArticle()` right after `insertArticle()`, before the AI queue (`server/rules.ts`). Actions are idempotent, so the same rule can be replayed over the newest 500 articles of its scope (`POST /api/rules/:id/apply`), and a dry run (`POST /api/rules/preview`) reports how many of the last 200 match, with sample titles. Invalid patterns are refused at creation (400) and never match at run time. Patterns are capped at 300 characters.

### Top stories

`server/db/stories.ts` takes the similarity pairs of the window (default 3 days, up to 14), joins them transitively with a union-find, and keeps clusters with at least two distinct feeds. Inside a cluster the leader is the first article by: unread, has an image, source trust plus quality, newest. Stories rank by `sources × 10 + average trust × 3 + leader quality`, then recency.

`GET /api/stories?days=&limit=` returns for each story the leader, the other coverage newest first, the distinct sources, the unread count and the latest publication date. The page keeps the same magazine card as the front page and folds the other coverage under a `<details>`.

### Feed trust and article quality

#### Trust

`recalculateFeedTrust()` (`server/db/trust.ts`) runs on the score cron. Over the articles a feed delivered in the last 30 days:

```
raw   = (opened × 1 + bookmarked × 2 + liked × 3 − hidden × 1) / max(delivered, 10)
trust = 1 − exp(−2 × raw)          -- 0..1
```

A feed whose every article is opened lands near 0.86; likes push it further; a feed nobody opens stays at 0. The sample floor of 10 keeps a single lucky read from making a brand-new feed look perfect. The value is exposed as `feeds.trust_score` and shown as a sortable percentage in Settings → Feeds.

#### Quality

`scoreArticleQuality()` (`server/quality.ts`) is computed at ingestion and on a successful retry. It starts at 0.7 and moves with: clickbait patterns in the title (English and French), a shouting title, exclamation marks, promotional markers in the title or opening of the body, a thin body (< 300 characters) or a short one (< 800), a long body (> 3000, bonus), and link density. Clamped to 0..1, stored in `articles.quality_score`. It never hides anything.

#### Where they count

- Front page (`server/db/frontpage.ts`): hero and sections order by `score + trust × 2 + quality` instead of `score` alone, so unread articles, which all have a zero engagement score, are told apart by their source and their body.
- Top stories: leader choice and story rank, see above.
- Recommended: tie-breaker after the interest score.

### Interest islands and Recommended

`server/interests.ts`:

1. Every article liked (3), bookmarked (2) or opened (1) in the last 90 days votes for the terms of its title and translated title. Tokens are lowercased, at least 3 characters, not a number, not in the English/French stopword list.
2. Votes are multiplied by an idf term computed over the newest 5,000 articles of the archive, so a word common to every feed carries little weight. Terms seen in fewer than 2 engaged articles are dropped (unless there are fewer than 5 engaged articles). The top 80 are kept, weights normalized to 0..1.
3. Islands: terms whose sets of engaged articles overlap with a Jaccard of at least 0.25 are joined with a union-find. Islands are numbered by total weight.
4. Muted flags survive a rebuild for terms that stay in the profile.

The profile is stored in `interest_terms` and rebuilt at most hourly by the score cron (`maybeRebuildInterestProfile()`), or on demand from Settings → General → Your interests. Each rebuild rescores the unread articles of the last 14 days; a new article is scored at insertion against the cached profile.

#### Class affinities

With article classification on ([87_feature_classification.md](./87_feature_classification.md)), `rebuildClassAffinities()` also learns how the reader treats each theme and format. Over the articles seen in the last 90 days that carry a classification, each class gets an engagement rate (same weights: like 3, bookmark 2, opened 1; a seen but never opened article counts 0), shrunk toward the overall rate with 5 pseudo-articles, then compared to it: `affinity = clamp(log2(rate / overall) / 2, -1, 1)`. Twice the average engagement is +0.5, half is -0.5. Classes seen fewer than 5 times are dropped. Rows live in `interest_classes (kind, class_id, affinity, seen, engaged, muted)`; muted rows survive every rebuild and count as -1. The classifier rescores an article as soon as it gets its theme and format.

`GET /api/interests` returns `{ islands, classes }`; `PATCH /api/interests/classes/:kind/:classId` with `{ muted }` mutes a class. Settings → General → Your interests shows the affinities as chips above the islands.

#### Score

`interest_score` of an article is the sum of the weights of the profile terms its title mentions, muted terms subtracting, plus the affinities of its theme and format (a top term weighs 1, so does a full affinity). `GET /api/articles?unread=1&sort=recommended` orders by `interest_score DESC`, then `trust + quality`, then date. `/recommended` is that list, without day separators since it is not chronological.

### API

| Endpoint | Purpose |
|---|---|
| `GET /api/smart-folders` | Folders with `unread_count` (null for free-text folders) |
| `POST /api/smart-folders` · `PATCH /api/smart-folders/:id` · `DELETE /api/smart-folders/:id` | CRUD (`name`, `query`, `sort_order`) |
| `GET /api/smart-folders/:id/articles?limit&offset` | `{ articles, total, has_more, folder }` |
| `GET /api/rules` · `POST /api/rules` · `PATCH /api/rules/:id` · `DELETE /api/rules/:id` | CRUD; `pattern` validated as a regular expression |
| `POST /api/rules/preview` | `{ scanned, matched, samples }` over the last 200 articles of the scope |
| `POST /api/rules/:id/apply` | Backfill over the newest 500 articles of the scope: `{ matched }` |
| `GET /api/stories?days=3&limit=30` | `{ stories }` |
| `GET /api/interests` | `{ islands: [{ id, terms: [{ term, weight, island, muted }] }] }` |
| `POST /api/interests/rebuild` | Forces a rebuild, returns the islands |
| `PATCH /api/interests/:term` | `{ muted: boolean }` |
| `GET /api/articles?sort=recommended` | Interest ordering on the article list |

### Schema

Migrations `0014`–`0017`: tables `smart_folders`, `feed_rules`, `interest_terms`; columns `articles.rule_boost`, `articles.quality_score`, `articles.interest_score`, `feeds.trust_score`. See [10_schema.md](./10_schema.md).

### Limits

- Quality is a heuristic. A classifier (RSSMonster uses ModernBERT) could replace `scoreArticleQuality()` behind the same column without touching the ranking.
- The interest profile reads titles only. Bodies would need an embedding or at least a per-article term vector to stay cheap on large archives.
- Story clustering inherits the similarity detector's limits: title-only, ±3 days, bigram Dice ≥ 0.4.
