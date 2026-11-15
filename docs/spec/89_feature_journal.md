# Oksskolten Spec — Journal

> [Back to Overview](./01_overview.md)

## Overview

An on-demand digest of everything that arrived since the previous edition: one sourced synthesis per article theme, written by the summary model, with a short "essentials" box on top. The reader generates an edition with a button on `/journal`; every covered article is then marked read.

## Motivation

- **Too many feeds to read**: high-volume sources (Reddit above all) produce more items than a reader can open. Lists, rankings and filters still leave the reader scrolling titles.
- **Community ranking is not personal relevance**: subscribing to `top` feeds keeps what others upvoted, not what this reader is looking for.
- **Nothing should slip through**: a digest that covers every article since the last one, with each statement linked to its source, lets the reader trust that skipping the list loses nothing. Uncited articles stay one click away.
- **A button, not a schedule**: the reader decides when to catch up. The next edition always resumes where the previous one stopped, however long ago that was.

## Scope

- Covered: articles created after the previous finished edition, excluding AI-filtered and rule-hidden articles (`filtered_at`), clips, and starred GitHub releases feeds (canonical `https://github.com/stars/<user>` in `rss_url` or `url`, see [86](./86_feature_github_releases.md)), which the reader follows on their own. Releases from other feeds, a single repository's `releases.atom` for instance, are covered like any article.
- Old backlog left out: articles published more than 7 days before the period starts are skipped and left unread, since a newly added feed brings its whole history in its first fetch. Undated articles stay in.
- Not covered: scheduled generation, per-feed digests, delivery by e-mail or chat.

## Design

### Edition lifecycle

`POST /api/journal/generate` (`server/intelligence/journal.ts`, `startEdition()`):

1. Marks editions stuck in `running` for more than 30 minutes as failed (`interrupted`): the process died mid-generation.
2. Refuses with `409 busy` while another edition is running.
3. Resolves the summary task's provider and model (`summary.provider`, `summary.model`) and checks its key; a missing key answers `400` before anything is written.
4. Period: `(period_start, period_end]` on `articles.created_at`. `period_start` is the previous finished edition's `period_end`; the first edition looks back one day. `period_end` is now. No articles answers `422 no_articles`.
5. Groups the articles by theme (below), inserts a `running` edition, answers `202 { id }` and writes the edition in the background.
6. On success the edition becomes `done` and every covered article is marked seen. On failure it becomes `error` with the message, and nothing is marked: the next edition covers the same period again, since it starts from the last *finished* edition.

The client polls `GET /api/journal` every 2 seconds while the latest edition is `running`; `sections_done` / `sections_total` drive the progress bar.

### Grouping

Articles are grouped by `articles.theme` in the reader's theme order ([87_feature_classification.md](./87_feature_classification.md)). Articles without a theme, with `OTHER`, or with a theme since removed from the list share the `_` bucket, placed last. With classification off every article is in `_`, and the single section is labelled "All news". Within a group, articles are ordered by importance (`ESSENTIAL`, then useful or undecided, then `SKIP`), then `interest_score`, `score` and newest.

### Writing a section

One model call per group (`buildSectionPrompt()`):

- Articles judged `SKIP` at classification time ([87_feature_classification.md](./87_feature_classification.md)) are never sent to the model; the section lists them as `skipped`. A group with only `SKIP` articles makes no call and gets an empty summary ("Nothing important in this theme").
- The 40 best remaining articles are listed as `[k] title (feed)` with up to 280 characters of summary, excerpt or full text. Larger groups are counted in the prompt ("the 40 most relevant of 120"); the rest is covered but not read by the model and listed as `overflow`. `uncited` holds only articles the model read and did not cite.
- The model writes 1 to 3 paragraphs in the reader's language (`general.language`), citing each statement as `[k]`, merging articles about the same subject, and saying so in one sentence when nothing stands out.
- The reader's instruction for the theme and the titles of recent "more like this" / "less like this" votes on that theme are appended.

`remapCitations()` rewrites the local `[k]` (and `[k, j]`) to edition-wide numbers, assigned in order of first citation, and drops numbers outside the list. A leading `<think>` block from reasoning models is stripped.

### Essentials

After the sections, one more call (`buildEssentialsPrompt()`) picks at most 3 points from the written sections, one sentence each, keeping their citations. Each point takes the theme of its first citation. A failure here is logged and leaves the box empty; the edition still succeeds.

### Feedback and instructions

- **Instruction per theme**: free text, at most 1000 characters, stored in `journal_instructions` keyed by theme id (`_` for the no-theme bucket). An empty text deletes it. It applies from the next edition, and to the importance of articles classified from then on.
- **More / less like this**: a vote on a cited source, stored in `journal_feedback` with the article's title and theme. "More like this" also likes the article, which feeds the interest profile ([87_feature_intelligence.md](./87_feature_intelligence.md)) and therefore the ordering of the next groups. Voting the same way again clears the vote.
- **Archive in Clips**: moves the article to the clip feed through `POST /api/articles/from-url` with `force: true` ([80_feature_clip.md](./80_feature_clip.md)).

### DB Schema

Migration `0021_journal.sql` (and `articles.importance` from `0022_article_importance.sql`):

| Table | Columns |
|-------|---------|
| `journal_editions` | `id`, `created_at`, `period_start` (NULL for the first), `period_end`, `status` (`running` / `done` / `error`), `error`, `article_count`, `sections_done`, `sections_total`, `content` (JSON), `finished_at` |
| `journal_instructions` | `theme` (PK), `instruction`, `updated_at` |
| `journal_feedback` | `article_id` (PK, cascades), `vote` (1 / -1), `theme`, `title`, `created_at` |

`content` follows `JournalContent` in `shared/journal.ts`: `sections` (theme, label, summary with `[n]` citations, article count, cited numbers, every covered article id, and the uncited articles' title / URL / feed), `sources` (number, article id, title, URL, feed, date) and `essentials`. Sources keep their own copy of title and URL, so an edition still reads after its articles are purged. The edition number shown to the reader is its rank among finished editions.

### API

| Endpoint | Description |
|----------|-------------|
| `GET /api/journal` | Latest edition (any status), `pending_count` (articles the next edition would cover), instructions, votes on the latest edition's sources |
| `GET /api/journal/editions` | Finished editions, newest first, without content |
| `GET /api/journal/editions/:id` | One edition with the votes on its sources |
| `POST /api/journal/generate` | Start an edition: `202 { id }`, `409 busy`, `422 no_articles`, `400` provider error |
| `PUT /api/journal/instructions/:theme` | `{ instruction }`; empty deletes |
| `POST /api/journal/feedback` | `{ article_id, vote: 1 \| 0 \| -1 }`; `404` for an unknown article |

### Frontend

`/journal` (`src/features/reading/pages/journal-page.tsx`), listed first in the sidebar, and the home page in simple mode ([50_frontend.md](./50_frontend.md)): `/` redirects there.

- Masthead with the edition's date and number, the covered period, an editions picker for past editions, and the generate button.
- A line with the number of articles waiting for the next edition, a progress bar while writing, or the error with a retry.
- Four figures: articles covered, sources cited, themes, minutes of reading (words of the written text at 200 per minute).
- The essentials box, then one numbered section per theme: the synthesis with superscript citations that open the article; each cited source as a compact margin note (number, feed, date, title, icon buttons for more / less like this and archive in Clips) in a right-hand column level with the paragraph that cites it first, pushed down only as far as needed not to overlap the previous notes (`useMarginNotes()`), or right under the paragraph on narrow screens; one disclosure gathering the articles read but not cited, those past the limit and those judged negligible; and the theme instruction.
- A footer recalling that the covered articles are marked read, and the unread count of the starred GitHub releases feeds left out.
