# Oksskolten Spec — Article Classification

> [Back to Overview](./01_overview.md)

## Overview

Every article gets a **format** (what kind of piece it is: news, question, guide, review…) and a **theme** (what it is about, from a list the reader edits). Both come from the local vLLM server, read as a closed-choice decision: the options are shown as letters, the model answers one token with logprobs, and the letter probabilities give a verdict plus a margin ([notjev](https://github.com/9pings/notjev)). When the margin is too thin, the article stays unclassified rather than getting a guess.

Formats and themes show up in the sidebar with their unread counts (`/formats/:id`, `/themes/:id`), and as `format:` / `theme:` filters in smart folders.

## Motivation

- **Categories describe feeds, not articles**: a general tech site posts about phones, AI and cars in the same feed; a subreddit mixes help requests, news and debates. Per-article classes sort what the feed-level category cannot.
- **Format is a reading mode**: "questions from r/LocalLLM" and "news about AI" are different moments of reading, and no keyword or rule captures the difference.
- **One token is cheap and honest**: no generated text to parse, about 0.3 s per question on a local 8B-27B model, and a real probability to abstain on instead of a confident wrong label.

## Scope

- The vLLM provider settings only (base URL and API key): any OpenAI-compatible server that returns logprobs on `/v1/chat/completions` works (vLLM, llama.cpp `llama-server`). The model must be an instruct model, not a thinking one.
- One format and one theme per article. Multi-label tagging is out of scope.
- Feed categories stay in the database, the OPML export and Settings → Feeds. With `classify.hide_categories` on (the default once classification is enabled), the reading UI shows themes where it showed categories; turning it off brings the folders back unchanged.

## Design

### Formats and themes

`shared/classification.ts` holds the fixed format list (11 entries, `OTHER` last) and the default theme list. Each option has an `id` (stored, filtered on), a `label` (shown) and a `description` (read by the model). Themes are stored as JSON in the `classify.themes` setting, up to 26 (one letter each); ids are normalized to `[A-Z0-9_]` and derived from the label when missing.

### Decision

`server/ai/classify.ts` builds the article state (title, feed name, first 1,500 characters of the body) and asks three questions in sequence (format, theme, importance), so each reuses the server's prefix cache for the article text. Each answer is `choice` or `null` when the margin between the two best options is below theta:

| Setting | Default | Meaning |
|---|---|---|
| `classify.enabled` | `off` | Master switch |
| `classify.model` | empty | vLLM model; empty falls back to `summary.model` |
| `classify.format_theta` | `0.5` | Minimum margin for a format |
| `classify.theme_theta` | `0.3` | Minimum margin for a theme (themes like AI / Computing overlap, and the top guess is usually right) |
| `classify.hide_categories` | `on` | Show themes instead of categories in the sidebar and the tab bar |

**Importance** is asked last, because its question carries the reader's journal instruction for the theme just decided and the titles of their 5 latest "more like this" / "less like this" votes on it ([89_feature_journal.md](./89_feature_journal.md)). Options are `ESSENTIAL`, `USEFUL` and `SKIP` (`IMPORTANCE` in `shared/classification.ts`), with a fixed theta of 0.3. Undecided stays `null`, which the journal reads as useful: a hesitating model never hides an article. Articles classified before importance existed keep `null` until a backfill with `all`.

Server errors throw, so the queue retries. If neither question saw an option letter (`degraded`: no logprobs, or the model answered outside the menu) the call counts as a failure, not as "undecided".

### Pipeline

The `classify` ingest step (new and clipped articles) enqueues task `classify` on the AI queue, after the AI filter. The worker skips articles the filter hid, then writes `format`, `theme`, `importance` (migration `0022_article_importance.sql`) and `classified_at`. `classify_pending_at` is the persistent marker the resume pass uses, like the other AI tasks.

`POST /api/classification/backfill` queues every active article with `classified_at IS NULL`, up to 5,000 per call, on a low-priority backlog drained only when the regular queue is empty, so new articles are translated and summarized first. Backfill items write no pending marker; after a restart the reader clicks again. `{ "all": true }` clears every verdict first (after editing the theme list).

### Hidden themes

Each theme in the editor has an eye toggle (`hidden: true` in `classify.themes`). A hidden theme stays in the model's options, so articles keep landing in it, but it leaves the sidebar (`GET /api/classification` omits it) and its articles are hidden everywhere: they get the AI filter's `filtered_at` marker plus `hidden_by_theme` (migration `0024_theme_hidden.sql`) naming the theme responsible. `syncHiddenThemes()` keeps the two in step: after a theme list save it hides every article of a hidden theme and brings back every article whose `hidden_by_theme` is no longer a hidden theme (un-hidden, renamed or removed); after each classification it does the same for that one article. Articles the AI filter or a rule hid have no `hidden_by_theme` and are never brought back. "Reclassify all" first brings back theme-hidden articles so they are classified again; the worker hides them anew if they land in a hidden theme.

### Theme suggestions

When themes get too broad, Settings → Classification → "Suggest themes" asks the summary model (`summary.provider` / `summary.model`, not vLLM: it needs free text) for a new list. The prompt carries the current themes and up to 300 recent titles of visible articles, at most 20 per feed so one busy feed does not drown the rest, and asks for distinct, balanced themes as a JSON array, labels and descriptions in the interface language. The server keeps the first array in the answer, drops duplicate ids and any "Other" the model added, caps the list at 25 and appends the current `OTHER` theme. The proposal replaces the editor contents unsaved; the reader edits it, saves (or discards), then reclassifies. `classify.suggest_max_tokens` overrides the 4,096-token answer cap.

### API

| Method | Path | Description |
|---|---|---|
| GET | `/api/classification` | `enabled`, `hideCategories` (only true while enabled), formats and themes with unread counts, `unclassified`, `pending` |
| GET | `/api/classification/settings` | Current settings |
| PATCH | `/api/classification/settings` | Update `enabled`, `model`, `formatTheta`, `themeTheta`, `themes`, `hideCategories` |
| POST | `/api/classification/suggest-themes` | Propose a finer theme list from recent titles (`{ count? }`, 3-25, default 18); returns `{ themes, sampled }`, stores nothing |
| POST | `/api/classification/test` | Classify `{ title, body? }` live, nothing stored |
| POST | `/api/classification/backfill` | Queue unclassified articles (`{ all: true }` to start over) |

`GET /api/articles` accepts `format` and `theme` (case-insensitive ids).

### Accuracy bench

Settings → Classification → Accuracy bench (or `npm run bench:notjev`) measures how right the three decisions are on the reader's own articles. It never writes to the production database: a child process copies it with `VACUUM INTO` into `data/notjev-bench-<ISO>/snapshot.db`, points its own `DATABASE_URL` at the copy, and only then imports the production modules, so the prompts are byte for byte those of `classifyArticle()`.

- Sample: articles carrying a label first (journal vote, liked, bookmarked), then a seeded random draw among classified articles. Articles whose title is injected as an example in the importance question are left out.
- Three readings per article: production; the same questions with options permuted (position bias); and a reference from the same model with thinking on, whose final `Answer: X` letter is parsed (unreadable answers are counted as such).
- Results are appended to `results.jsonl` as they come, so a stopped run resumes without repeating calls; `replay.json` is a `notjev replay` recording.
- `report.html` is self-contained: agreement against a null arm, importance accuracy against labels (strict and soft), confusion matrices, theta curve recomputed offline, accuracy by band, position bias, coverage, time, reproducibility against stored values, and the list of disagreements with buttons. Arbitrations are exported as JSON and imported back, which recomputes the figures without any call.

Configuration: `scripts/notjev-bench.config.json`; usage: `scripts/README-notjev-bench.md`.

### Frontend

- Sidebar: "Themes" and "Formats" sections under smart folders, collapsible, hidden while classification is off.
- `/themes/:id` and `/formats/:id` list unread articles only; once all are read, the empty state offers "Show read articles", as categories do with the unread-only option.
- Hidden categories: the sidebar lists feeds flat, sorted by name, with drag-and-drop to folders disabled (there is no folder to drop into), and the tab bar above article lists (`category-tabs.tsx`) links to `/themes/:id` instead of `/categories/:id`.
- Settings → Integration → Article classification: switch, model, thresholds, theme editor with theme suggestions and hidden themes, live test, backfill and reclassify, accuracy bench.

### Key Files

| File | Description |
|---|---|
| `shared/classification.ts` | Formats, default themes, shared types |
| `server/ai/classify.ts` | Settings and the notjev decision |
| `server/ai/queue.ts` | `classify` task, backlog, resume |
| `server/ai/classify-routes.ts` | Classification API |
| `server/ingest/steps/classify.ts` | Enqueue on ingestion |
| `src/features/feeds/components/classification-list.tsx` | Sidebar sections |
| `src/features/settings/sections/classification-section.tsx` | Settings section |
| `scripts/format-eval.ts` | Offline evaluation against a real database |
| `server/bench/notjev/` | Accuracy bench: snapshot, calls, analysis, report, routes |
| `src/features/settings/sections/classification-bench.tsx` | Accuracy bench panel |
| `scripts/notjev-bench.config.json` | Accuracy bench configuration |
