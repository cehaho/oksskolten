<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://assets.babarot.dev/files/2026/03/aeeb41766d888243.png">
    <source media="(prefers-color-scheme: light)" srcset="https://assets.babarot.dev/files/2026/03/c11e0ce04f0d06e6.png">
    <img alt="Inbox" src="https://assets.babarot.dev/files/2026/03/c11e0ce04f0d06e6.png" alt="Oksskolten — The AI-native RSS reader">
  </picture>
</p>
<!--
<p align="center">
  <img src="./public/og-image.png" alt="Oksskolten — The AI-native RSS reader" width="640" />
</p>
-->

<p align="center">
  <a href="https://github.com/babarot/oksskolten/actions/workflows/test.yaml"><img src="https://github.com/babarot/oksskolten/actions/workflows/test.yaml/badge.svg" alt="Tests" /></a>
  <a href="https://github.com/babarot/oksskolten/actions/workflows/test.yaml"><img src="https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/babarot/7de3479899077c477335584e14d51adc/raw/oksskolten-server-coverage.json" alt="Server Coverage" /></a>
  <a href="https://github.com/babarot/oksskolten/actions/workflows/test.yaml"><img src="https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/babarot/7de3479899077c477335584e14d51adc/raw/oksskolten-client-coverage.json" alt="Client Coverage" /></a>
</p>

<p align="center">
  <strong>Oksskolten</strong> <em>(pronounced "ooks-SKOL-ten")</em> — every article, full text, by default.
</p>

<p align="center">
  <strong>English</strong> · <a href="README.fr.md">Français</a>
</p>

> Oksskolten started as a fork of [babarot/oksskolten](https://github.com/babarot/oksskolten)
> and diverged from it in September 2026 (upstream base `bdb22ac`). It is
> maintained independently; upstream fixes are ported by hand when they apply.
> [`FORK.md`](FORK.md) records what had been added on top of upstream at the
> point of divergence.

## Why Oksskolten?

Most RSS readers show what the feed gives you — a title and maybe a summary. Some (like Miniflux and FreshRSS) can fetch full article text, but it's opt-in per feed and requires configuration. Oksskolten does it for every article automatically: it fetches the original article, extracts the full text using Mozilla's Readability + 500 noise-removal patterns, converts it to clean Markdown, and stores it locally. No per-feed toggles, no manual CSS selectors — it just works.

Because Oksskolten always has the complete text, AI summarization and translation produce meaningful results, full-text search actually covers everything, and you never need to leave the app to read an article.

## See it in action

🕺 Live Demo → [demo.oksskolten.com](https://demo.oksskolten.com)

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/screenshots/home-default-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="docs/images/screenshots/home-default-light.png">
    <img alt="Home" src="docs/images/screenshots/home-default-dark.png" width="49%">
  </picture>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/screenshots/inbox-default-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="docs/images/screenshots/inbox-default-light.png">
    <img alt="Inbox" src="docs/images/screenshots/inbox-default-dark.png" width="49%">
  </picture>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/screenshots/article-chat-default-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="docs/images/screenshots/article-chat-default-light.png">
    <img alt="Article" src="docs/images/screenshots/article-chat-default-dark.png" width="49%">
  </picture>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/screenshots/appearance-default-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="docs/images/screenshots/appearance-default-light.png">
    <img alt="Appearance" src="docs/images/screenshots/appearance-default-dark.png" width="49%">
  </picture>
</p>

## Features

- **Full-Text Extraction** — Every article is fetched from its source and processed through Readability + 500 noise-removal patterns. You read complete articles inside Oksskolten, never needing to click through to the original site
- **AI Summarization & Translation** — On-demand article processing via Anthropic, Gemini, or OpenAI with SSE streaming. Works on full article text, not RSS excerpts
- **Interactive Chat** — Multi-turn AI conversations with MCP tooling; search articles, get stats, and ask questions about your feeds
- **Full-Text Search** — Meilisearch-powered search across your entire article archive
- **Smart Fetching** — Adaptive per-feed scheduling, conditional HTTP requests (ETag/Last-Modified), content-hash deduplication, exponential backoff, and tracking parameter removal
- **PWA** — Offline reading, background sync, and add-to-home-screen support
- **Multi-Auth** — Password, Passkey (WebAuthn), GitHub OAuth, and OpenID Connect (Pocket ID, Authelia, Authentik, ...) — each independently configurable
- **Smart Feed Management** — Auto-discovery, CSS selector-based feeds (via RSS Bridge), bot bypass (FlareSolverr), and automatic disabling of dead feeds
- **Article Clipping** — Save any URL as an article, with full content extraction
- **Theming** — 14 built-in color themes + custom theme import via JSON, 9 article fonts, 8 code highlighting styles
- **Single Container** — API, SPA, and cron scheduler all run in one Docker container

## Fork additions

Everything below was added on top of upstream before the two projects diverged; it is now simply part of Oksskolten. [`FORK.md`](FORK.md) covers each item in detail, down to the upstream files touched.

### Reading experience

- **Front page (La Une)** — `/` is a newspaper-style front page: a hero article picked by score, then the top unread articles of each category. The chat-first home screen it replaces is still there, at `/chat`
- **Journal** — press a button to get one sourced synthesis per theme of everything that arrived since the previous edition, written by your summary model, with the three essentials on top. Steer each theme with a free-text instruction and *more / less like this* votes; covered articles are marked read, starred GitHub releases stay apart. See [`92_feature_journal.md`](docs/spec/92_feature_journal.md)
- **Simple mode** — on by default: the journal is the home page and the sidebar keeps only search, bookmarks, clips, GitHub releases and themes. Everything else stays reachable by URL, and one switch in Settings → Reading brings the full navigation back
- **Category tabs** — a horizontal section bar above article lists (Inbox plus one tab per category, with per-category unread counts)
- **Bottom tab bar** — newspaper-app-style bottom navigation (Inbox, Search, Read Later, Chat, Menu), shown when the sidebar is closed. The sidebar's collapsed state now persists across reloads
- **Swipe between articles** — swipe left/right, or press the arrow keys, to move through the list you came from
- **Mark as read without opening** — a check button on every unread card, in all five layouts. On touch devices, swiping a card to the right does the same
- **Embedded videos survive** — a video the article embedded used to be dropped at extraction, leaving its caption behind; it is now kept as a play card. With video archiving switched on, a button on the article keeps a copy of the video itself, so the article stays complete after the source takes it down (requires `yt-dlp`)
- **Per-feed image auto-archive** — image archiving normally runs when an article is opened; feeds you keep as archives can be flagged (context menu → Auto-archive images) to download every article's images at fetch time, existing backlog included
- **Articles that live in an embedded page** — when a page turns out to be a shell whose text sits in an iframe (a Hugging Face Space, a document viewer) or one meta refresh or AMP link away, the fetcher follows that pointer once and reads the text there, keeping the saved page's title and preview image
- **The lead image survives** — WordPress-style themes (Hackaday among them) keep the featured image in the post header, which extraction throws away, so the list showed a thumbnail the article body did not have. When the extracted body opens without an image, the page's `og:image` is restored as the hero
- **Le Monde theme** — an importable custom theme inspired by the newspaper's app (`custom-themes/le-monde.json`)

### AI pipeline on a local model

Upstream runs AI on demand, one article at a time. This fork adds a persistent background queue (`server/fetcher/ai-queue.ts`) that survives restarts: pending work is marked in the database, resumed at the start of every fetch cycle with a 10-minute backoff, and processed in bounded batches against a local vLLM endpoint.

- **Auto-translation on fetch** — every article whose detected language differs from your target language is translated in the background. The scope is configurable: body and title, or titles only — cheaper, and the only option that still helps once an article's body has failed to extract. Detection uses franc-min, and French is available as a target language
- **Auto-summarize on fetch** — summaries are generated as articles arrive rather than on click
- **Per-feed AI relevance filter** — give a feed a criterion in your own words and every new article is judged against it. Rejected articles are hidden, never deleted, so a bad criterion is reversible

### More kinds of feeds

- **GitHub starred releases** — paste `https://github.com/stars/<user>` for a single feed carrying the releases of every repository that account has starred. One GraphQL query per 100 repositories, with a configurable release / pre-release / tag mix. See [`86_feature_github_releases.md`](docs/spec/86_feature_github_releases.md)
- **GitHub trending** — paste `https://github.com/trending`, with or without a language, period or spoken-language filter, and the board becomes a feed. GitHub serves no feed for it, so the page is read directly; each repository is one article, dated the first time it trended. See [`88_feature_github_trending.md`](docs/spec/88_feature_github_trending.md)
- **Discord channels** — paste a channel link and its messages become articles, each with its text, embeds and attachments. Needs a bot token and a bot invited to the server with View Channel and Read Message History. See [`89_feature_discord_channel.md`](docs/spec/89_feature_discord_channel.md)
- **Social searches as feeds** — Bluesky custom feeds, profiles and searches, plus Mastodon hashtags, each become a feed. Bluesky search needs an app password; the rest work without an account
- **Reddit posts, properly** — the body comes from the post's own JSON, including the embedded parent of a crosspost, and the top comments are rendered below the article with an on-demand translate button. Fetches escalate through five access strategies, because Reddit blocks anonymous requests from many residential IPs

### Reading intelligence

Five features borrowed from RSSMonster's smart layer, all running on SQLite and the existing search index, no model involved. See [`87_feature_intelligence.md`](docs/spec/87_feature_intelligence.md)

- **Smart folders** — save a query such as `rust unread:true @week` as a sidebar folder; new matches appear on their own. The search dialog offers *Save as smart folder* for the current search
- **Automated rules** — regular-expression rules, per feed or global, that mark new articles read, hide them, bookmark or like them, or change their score. Dry-run a pattern over recent articles before saving, replay it over the backlog after
- **Top stories** — events covered by several of your sources are folded into one story, ranked by how many sources covered it, with the other coverage one click away
- **Feed trust and article quality** — a per-feed trust score from what you actually read of it, and a per-article quality score (thin body, clickbait or shouting title, promotional markers, link density). Both feed the front page ranking; trust is a sortable column in Settings → Feeds
- **Interest islands and Recommended** — an interest profile learned from what you like, bookmark and open, grouped into islands of co-occurring terms you can mute; the *Recommended* list ranks unread articles against it. With article classification on, it also learns which themes and formats you read more, or less, than average

### Article classification

Your local vLLM server gives every article a **format** (news, question, discussion, guide, review, release…) and a **theme** from a list you edit, shown as sidebar sections with unread counts and usable in smart folders (`format:question theme:ai`). Each class is a one-token decision read from logprobs ([notjev](https://github.com/9pings/notjev)): when the model hesitates the article stays unclassified instead of getting a guess. Enable it in Settings → Integration; themes then replace feed categories in the sidebar and the tab bar (categories are kept and can be shown again). See [`87_feature_classification.md`](docs/spec/87_feature_classification.md)

An accuracy bench (Settings → Integration → Article classification, or `npm run bench:notjev`) asks the three questions again on a snapshot of your database, against a permuted order and a reasoned reference, and writes a self-contained HTML report where you can arbitrate disagreements. See [`scripts/README-notjev-bench.md`](scripts/README-notjev-bench.md)

### Feed management and diagnostics

**Settings → Feeds**, an empty "under development" placeholder upstream, now holds two sections:

- **Diagnostics** — the feeds that are failing or disabled, each with the pipeline stage that broke, the likely cause in plain words, the raw error one click away, and re-detect / retry / re-enable buttons. `Retry all` re-enables and re-fetches the whole list
- **Management table** — every subscription with its article, unread and per-week counts, last article date and status. Search, sort on any column, filter by category or status, and select feeds (Shift+Click for ranges) to move, fetch, mark read, re-enable or delete them in bulk

### Git backup

Archive the GitHub repositories you consider strategic on your own Forgejo (or Gitea) instance, from Settings → Integration or from the archive chip on any article that points at a repository. Forgejo clones and stores the code itself, so the repository data is not copied into Oksskolten. Syncs run only when you ask. Each one is checked first: if upstream deleted or rewrote an archived version tag or force-pushed the default branch, the sync is held back. You then choose to freeze the archive as it is, or accept the loss. Floating tags (`nightly`, `v4`) and short-lived branches are ignored. See [`86_feature_git_backup.md`](docs/spec/86_feature_git_backup.md)

### Tooling and fixes

- **E2E smoke tests** (`npm run test:e2e`) — Playwright builds the app, boots the real server against a scratch database, and checks the front page, the inbox → reader flow, and the mobile bottom bar
- **Database backup** (`scripts/backup-db.sh`) — WAL-safe snapshots through SQLite's online backup API, with gzip and rotation
- **Extraction debugger** (`scripts/debug-extract.ts`) — replays fetch, clean and extract for one URL, then re-runs the parse with each cleaning stage disabled so the stage that lost the text names itself
- **Upstream fixes** — CSP hashes for the inline bootstrap scripts, a Firefox-safe logo font stack, an over-broad `next-` cleaning pattern that deleted whole article bodies, a re-detect path that permanently broke GitHub-stars and social feeds, and an i18n placeholder that printed a literal `{{code}}` instead of the HTTP status

Fork-specific environment variables (Reddit, Bluesky, vLLM) are documented in [`.env.example`](.env.example).

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | [Node.js 22](https://nodejs.org/) + [Fastify](https://fastify.dev/) |
| Frontend | [React 19](https://react.dev/) + [Vite](https://vite.dev/) + [Tailwind CSS](https://tailwindcss.com/) + [shadcn/ui](https://ui.shadcn.com/) |
| Database | [SQLite](https://sqlite.org/) via [libsql](https://github.com/tursodatabase/libsql) (WAL mode) |
| AI | [Anthropic](https://docs.anthropic.com/) / [Gemini](https://ai.google.dev/) / [OpenAI](https://platform.openai.com/) |
| Search | [Meilisearch](https://www.meilisearch.com/) |
| Auth | JWT + [Passkey / WebAuthn](https://webauthn.io/) + GitHub OAuth + OpenID Connect |
| Deployment | Docker Compose + [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) |

## Architecture

```mermaid
graph TD
    subgraph host["Docker Host"]
        subgraph app["oksskolten (Node.js 22, port 3000)"]
            fastify["Fastify API<br/>/api/*"]
            spa["SPA static serving<br/>(Vite build)"]
            sqlite["SQLite<br/>(WAL mode)"]
            cron["node-cron<br/>Feed fetch every 5 min"]
            fetcher["Fetcher Pipeline<br/>RSS parse → Readability<br/>→ HTML cleaner → Markdown"]
            ai["AI Provider<br/>Anthropic / Gemini / OpenAI"]
            chat["Chat Service<br/>MCP Server + 4 Adapters"]

            fastify --> sqlite
            fastify --- spa
            fastify --> fetcher
            fastify --> ai
            fastify --> chat
            cron --> fetcher
            fetcher --> sqlite
            chat --> sqlite
            chat --> ai
        end

        bridge["RSS Bridge<br/>(Docker, port 80)"]
        flare["FlareSolverr<br/>(Docker, port 8191)"]
        tunnel["cloudflared<br/>(Cloudflare Tunnel)"]
    end

    user(("User")) -- "HTTPS" --> tunnel
    tunnel --> fastify
    cron -- "HTTP fetch" --> rss(("RSS Feeds"))
    fetcher --> bridge
    fetcher --> flare
    ai -- "API" --> llm_api(("Anthropic / Gemini<br/>/ OpenAI API"))
```

Everything runs in a single long-lived process — SQLite needs local disk, and node-cron needs a process that stays alive. This rules out serverless/edge runtimes but keeps the stack simple: one container, no external queues or coordination. For cloud deployment, a small VM or [Fly.io + Turso](docs/guides/deploying-to-fly-io.md) works well.

Oksskolten also exposes an MCP server, so Claude Code or any MCP client can search, summarize, and query your article archive without opening the app.

> **What's in a name?** Oksskolten is the highest peak in northern Norway — a mountain of knowledge for your feeds.

### Content Pipeline

Unlike traditional RSS readers that rely on feed-provided summaries, Oksskolten fetches every article directly from its source URL and extracts the full text. This means the reader is self-contained — no need to leave the app to read an article.

1. **Fetch RSS** — Adaptive per-feed scheduling with conditional requests (ETag/Last-Modified/content hash)
2. **Parse** — RSS/Atom/RDF parsed via feedsmith + fast-xml-parser, tracking parameters stripped
3. **Fetch Article** — Original article URL fetched directly (with FlareSolverr fallback for bot-protected sites)
4. **Extract** — Full article content extracted with Readability in isolated Worker Threads
5. **Clean** — ~500 noise-removal patterns strip ads, nav, sidebars, and tracking elements
6. **Convert** — HTML converted to Markdown with GFM support
7. **Enrich** — Language detection, OGP image extraction, excerpt generation
8. **Index** — Articles indexed in Meilisearch for full-text search

### Smart Fetching

The feed fetcher minimizes bandwidth and adapts to each feed's behavior, inspired by best practices from FreshRSS, Miniflux, and CommaFeed:

- **3-layer change detection** — HTTP 304 (ETag/Last-Modified) → content hash (SHA-256) → full parse. Unchanged feeds are caught early without parsing XML
- **Adaptive scheduling** — Each feed gets its own check interval (15min–4h) based on three signals: HTTP `Cache-Control`, RSS `<ttl>`, and actual article frequency. Active blogs are checked often; dormant ones back off automatically
- **Resilient error handling** — Exponential backoff on errors (1h–4h cap), but feeds are never disabled. Rate limits (429/503) respect `Retry-After` headers without counting as errors
- **URL deduplication** — 60+ tracking parameters (utm_*, fbclid, gclid, etc.) are stripped before duplicate checking, preventing the same article from being inserted twice

## Comparison

| | Oksskolten | [Miniflux](https://github.com/miniflux/v2) | [FreshRSS](https://github.com/FreshRSS/FreshRSS) | [Feedly](https://feedly.com/) |
|---|---|---|---|---|
| **Full-text extraction** | Every article, by default | Opt-in per feed | Opt-in per feed | Auto (best-effort) |
| **Extraction engine** | Readability.js + 500 patterns | Go Readability (~390 lines, ~60 rules) | Manual CSS selectors | Proprietary |
| **JS-rendered sites** | FlareSolverr | — | — | Enterprise only |
| **Sites without RSS** | Auto-discovery → RSS Bridge → LLM inference | — | — | Pro+ (25) / Enterprise (100) |
| **AI summarization** | Built-in (Anthropic/Gemini/OpenAI) | — | — | Pro+ only (Leo) |
| **AI translation** | Built-in (+ Google Translate, DeepL) | — | — | Enterprise only |
| **AI chat** | MCP-powered, searches archive | — | — | — |
| **Search** | Meilisearch (typo-tolerant) | PostgreSQL full-text | SQL LIKE | Pro+ (Power Search) |
| **Database** | SQLite (embedded, WAL) | PostgreSQL (external) | MySQL/PG/SQLite | SaaS |
| **Deployment** | Single container | Binary + PostgreSQL | PHP + web server + DB | SaaS |
| **Offline reading** | PWA with background sync | — | — | Mobile apps only |
| **Auth** | Password + Passkey/WebAuthn + GitHub OAuth + OIDC | Password + API key | Password + API key | Google/Apple/social + SAML (Enterprise) |
| **Themes** | 14 + custom JSON import | Light/Dark | ~10 themes | — |
| **Language** | Node.js (TypeScript) | Go | PHP | — |
| **Price** | Free / OSS (AGPL-3.0) | Free / OSS (Apache-2.0) | Free / OSS (AGPL-3.0) | $12.99/mo (Pro+) |

Miniflux and FreshRSS are excellent, mature projects. Oksskolten's focus is different: full-text extraction and AI as first-class defaults, not optional add-ons.

## Development

```bash
docker compose up --build   # HMR enabled
# Frontend: http://localhost:5173
# Backend:  http://localhost:3000

npm test                    # Run all tests
npm run build               # Production build
```

On first startup with an empty database, sample feeds and articles are automatically loaded from the demo seed data (`src/lib/demo/seed/*.json`). This gives you a populated UI to work with immediately. The seed is idempotent — it only runs when no RSS feeds exist in the database. To start with an empty database instead, set `NO_SEED=1`.

See [`.env.example`](.env.example) for available environment variables. AI provider keys are configured through the Settings UI.

## Deployment

Runs anywhere Docker runs — a home NAS, a Raspberry Pi, or a cloud VM.

### Using pre-built images

Pre-built multi-architecture Docker images (amd64/arm64) are published to GHCR on every release:

```bash
docker pull ghcr.io/babarot/oksskolten:latest
```

> The published image is upstream's and contains none of the [fork additions](#fork-additions). To run this fork, build locally.

To use the pre-built image instead of building locally, edit `compose.prod.yaml` and swap the `build` directive for the commented-out `image` line, then:

```bash
docker compose -f compose.yaml -f compose.prod.yaml up -d
```

### Building locally

```bash
# Production with Cloudflare Tunnel
docker compose -f compose.yaml -f compose.prod.yaml up --build -d
```

The production compose file includes a `cloudflared` sidecar that exposes the app via Cloudflare Tunnel — no port forwarding or static IP required.

## License

[AGPL-3.0](LICENSE)
