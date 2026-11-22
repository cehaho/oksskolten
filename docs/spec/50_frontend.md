# Oksskolten Spec — Frontend

> [Back to Overview](./01_overview.md)

## Frontend

### Route Definitions

```
/                              → Redirect to /inbox
/inbox                         → Unread articles list
/bookmarks                     → Bookmarked articles list
/likes                         → Liked articles list
/history                       → Read articles list (read_at IS NOT NULL)
/clips                         → Clipped articles list
/recommended                   → Unread articles ranked by the interest profile
/stories                       → Top stories (events covered by several sources)
/journal                       → Journal: on-demand sourced digest by theme (home page in simple mode)
/smart/:folderId               → Smart folder (saved query) articles list
/feeds/:feedId                 → Articles by feed (clip feeds also use this route)
/categories/:categoryId        → Articles by category
/settings                      → Redirect to /settings/general
/settings/:tab                 → Settings page (general / appearance / integration / plugins / security / data / viewer / about)
/chat                          → Chat page (conversation list + new-conversation input)
/chat/:conversationId          → Chat page (conversation detail)
/*                             → Article detail (catch-all, original article URL with scheme removed)
```

The display URL for an article is the original article URL with the scheme removed:
```
https://blog.cloudflare.com/new-features-2025
→ /blog.cloudflare.com/new-features-2025
```

The frontend prepends `https://` to the splat path to reconstruct the original article URL, then fetches the article data via `GET /api/articles/by-url?url=...`.

Paths ending with `.md` are treated as Markdown source view pages (`ArticleRawPage`).


### Simple Mode

A reading preference (`reading.simple_mode`, Settings → Reading, on by default) that trims the navigation for readers who only want a short, curated view. It hides entry points only: every route keeps working from its URL, and turning the mode off restores the full sidebar.

| Surface | Kept | Hidden |
|---------|------|--------|
| Sidebar | Journal, Search, Bookmarks, Clips, GitHub Releases, Add, Themes | Inbox, Top stories, Recommended, Likes, History, Chat, Smart folders, Formats, the feed list |
| Bottom tab bar | Journal, Search, Bookmarks, Menu | Inbox, Chat |
| Section bar above lists | — | the whole bar (themes are in the sidebar) |

- **GitHub Releases**: each enabled starred-releases feed (`rss_url` `https://github.com/stars/<user>`, whatever form of the URL was pasted, see [86](./86_feature_github_releases.md)) gets its own sidebar entry with its unread count, since the feed list that would otherwise show it is hidden.
- **Home page**: `/` redirects to `/journal` ([89](./89_feature_journal.md)) instead of showing the front page.
- **Feed list fallback**: the feed list is hidden only while article classification is on. Without themes the sidebar would offer nothing to read, so the feed list stays.

### Command Palette & Keyboard Shortcuts

The command palette (`Cmd+K`) provides unified access to navigation, actions, feeds, and appearance settings. It uses `cmdk` (shadcn/ui `CommandDialog`).

| Shortcut | Action |
|---|---|
| `Cmd+K` | Open command palette |
| `Cmd+Shift+K` | Open article search |
| `Cmd+N` | Add new feed |
| `Cmd+,` | Open settings |
| `Cmd+1`–`5` | Navigate to Inbox / Bookmarks / Likes / History / Chat |

Command palette groups:
- **Navigation** — Inbox, Bookmarks, Likes, History, Chat, Settings
- **Actions** — Search articles, Add feed, Import/Export OPML
- **Feeds** — Dynamic list from SWR, shown only when search input is non-empty (clip feeds excluded)
- **Appearance** — Theme, layout, and color mode switching

All items include English `keywords` for cross-language matching (e.g., typing "chat" matches the localized label in French locale).

The interface is offered in French, English and Chinese (`LOCALES` in `src/i18n/index.ts`). The locale comes from `?lang=`, then the stored choice, then the profile language, then the browser language, English otherwise; a stored locale that is no longer offered (Japanese was dropped) falls back the same way. Every dictionary entry must carry all three texts, which the type check enforces.

Global shortcuts are managed by `useGlobalShortcuts` hook in `src/hooks/use-global-shortcuts.ts` and registered in `FeedList`.


### Data Fetching

| Item | Approach |
|---|---|
| Library | SWR |
| Pagination | Infinite scroll (`useSWRInfinite`, `limit=20` per page) |
| Display range limit | Smart Floor — For feed/category views, adopts whichever range contains the most articles among three candidates: "last 1 week", "latest 20 articles", and "up to the oldest unread". Skipped if fewer than 20 articles exist. Not applied to Inbox/Bookmarks/Likes/History/Clips |
| Show older articles | When Smart Floor hides articles, a "show older articles (N)" button appears at the end of the list. Clicking it re-fetches with `no_floor=1` to show all articles |
| Scroll stop condition | Stops when response `has_more === false` |
| Loading | Skeleton UI |
| Error | Inline message + retry button |
| Empty state | "No articles" (centered with `text-muted`) |

**Fetch completion toast**: Displays results via `sonner` toast upon completion of manual fetch (refresh button / right-click → Fetch) and pull-to-refresh (individual feed pages only).

| Condition | Toast |
|---|---|
| New articles found | `Fetched {count} new article(s)` (success) |
| No new articles | `No new articles` (default) |
| Error | `Fetch failed` (error) |

Pull-to-refresh calls `startFeedFetch(feedId)` on individual feed pages to fetch from the RSS source. On aggregate pages (Inbox, etc.), it only performs SWR `mutate()` as before.

**Fetch progress sharing**: The `useFetchProgress` hook is shared via `FetchProgressContext`, allowing the sidebar and article list to reference the same progress state.

**Cache invalidation**: After mutations, related caches are revalidated using `mutate()`.

| Operation | Revalidation target |
|---|---|
| Add feed (`POST /api/feeds`) | `/api/feeds` |
| Delete feed (`DELETE /api/feeds/:id`) | `/api/feeds`, `/api/articles` |
| Update feed (`PATCH /api/feeds/:id`) | `/api/feeds` |
| Seen/read update (`PATCH .../seen`, `POST .../read`) | `/api/feeds` (to update unread_count) |
| Manual fetch (refresh icon, context menu, pull-to-refresh) | `/api/feeds`, `/api/articles`, `/api/frontpage` |

The article list needs more than a `mutate()` on its keys. It is a `useSWRInfinite`
hook, and that fetcher only refetches a page when the page is missing from the cache,
when `revalidateAll` is on, or when the hook's own `mutate` set the force flag — and
`revalidateFirstPage` is off outside collection views. A global mutate therefore woke
the hook and handed back the same cached pages: the toast announced new articles while
the list stayed as it was until the page was reloaded. `src/lib/article-list-refresh.ts`
is a small bus for that: `useArticlePages` subscribes its bound `mutate`, and anything
that brings in articles (the fetch-progress revalidation, the feed actions, the
auto-refresh poll) emits on it.

Revalidation is disabled app-wide (`revalidateIfStale`, `revalidateOnFocus` and
`revalidateOnReconnect` are all `false`), so a cached response survives until a full
page reload. One case must not: an article whose `full_text` is empty is an unfinished
answer, since the server fills the body in later (retry pass, anti-bot solver, a
re-clip). `ArticleDetail` therefore refetches its own key once per article when the
cached copy has no body — otherwise a clip read too early stays blank for the rest of
the session while the list, keyed separately, already shows the recovered text.

The other exception is the server's scheduled fetch, which the client never hears
about. `useArticleAutoRefresh` (mounted once in `AppLayout`) polls `/api/feeds` every
60 seconds while the tab is visible, and revalidates the article lists and the front
page when a feed's `article_count` moves. Unread counts are deliberately left out of
that comparison: they change as the reader marks articles, and refetching an
unread-only list on that would pull articles out from under them.

The polling is the hook's own `setInterval`, not SWR's `refreshInterval`. SWR skips
the revalidation on every tick whose key holds an error (`!getCache().error` in its
interval loop) and, with focus and reconnect revalidation off, nothing brought it
back: one failed request — a server restart, a sleeping laptop, a dropped connection —
froze a tab's lists until it was reloaded, which is what a window left open for days
runs into. An explicit `mutate('/api/feeds')` revalidates whatever the last result was.
Hidden tabs skip their tick and catch up on `visibilitychange`, however long they have
been away.


### Feed Metrics

Displays update frequency and activity level for feeds.

**Sidebar (Inactive indicator)**
- When `showFeedActivity === 'on'` and the feed is inactive, an `inactive` label is shown next to the feed name
- Inactive criteria: `latest_published_at` is more than 90 days ago, or the feed has articles but `latest_published_at` is null
- This is a separate concept from `disabled` (automatic deactivation due to fetch errors)
- Display controlled by setting `reading.show_feed_activity` (on/off, default: on)

**Metrics bar (below article list header)**
- Shown only on individual feed views (`/feeds/:feedId`). Hidden on Inbox and category views
- Displayed items: total article count, update frequency (X.X/wk), last updated (relative time), average article length
- Lightweight data (article count, update frequency, last updated) is obtained from the `/api/feeds` SWR cache
- Heavy data (average article length) is fetched on demand from `/api/feeds/:id/metrics`
- Not displayed for clip feeds

### Markdown Rendering

All Markdown-to-HTML rendering goes through `renderMarkdown()` in `src/lib/markdown.ts`. This function applies a preprocessing pipeline before passing the result to `marked` (GFM mode, with `highlight.js` syntax highlighting).

**Pipeline architecture**

```
renderMarkdown(md, [optional preprocessors])
  → [...optional, ...default] preprocessors (reduce)
  → markedInstance.parse()
```

Each preprocessor is a pure function `(md: string) => string`. The pipeline runs optional (caller-specified) preprocessors first, then the default pipeline.

| Preprocessor | Pipeline | Description |
|---|---|---|
| `fixLegacyMarkdown` | Default | Repairs malformed HTML in articles stored before server-side normalization (e.g. `<picture>` → `![](src)`, multi-line link collapsing) |
| `escapeNestedBrackets` | Default | Escapes `[` `]` inside link text so titles like `[AINews] Title` render correctly |
| `rewriteLinksToAppPaths` | Optional (chat) | Rewrites external URLs in links to in-app paths |

**Usage by context**

| Context | Call | Files |
|---|---|---|
| Article body | `renderMarkdown(md)` | `article-detail.tsx` |
| Article summary | `renderMarkdown(summary)` | `use-summarize.ts` |
| Translation preview | `renderMarkdown(text)` | `use-streaming-ai.ts` |
| Chat messages | `renderMarkdown(md, [rewriteLinksToAppPaths])` | `chat-message-bubble.tsx` |

**Shared utilities**

`walkLinks(s, visitor)` provides bracket-aware markdown link scanning (handles nested brackets, skips image links). Used by both `escapeNestedBrackets` and `rewriteLinksToAppPaths` to avoid duplicated link-parsing logic.

**Implementation files**
- `src/lib/markdown.ts` — `renderMarkdown`, `walkLinks`, preprocessors, `markedInstance`


### Article List Display Layouts

Four layout options are available for the article list. Independent from the theme (color), allowing free combination.

| Layout | Key | Description |
|---|---|---|
| List | `list` | Classic single-column list. An 80px thumbnail on the left, then the full title (wrapped, never truncated), a one-line excerpt and the domain. Default |
| Card | `card` | 2-column grid. Large thumbnail (aspect-video) placed at the top. Visual-oriented |
| Magazine | `magazine` | Mixed layout with the first article as a hero (large card) and the rest as smaller cards |
| Compact | `compact` | High-density list with title and date only. No thumbnails |

- Setting key: `appearance.list_layout` (allowed values: `list` / `card` / `magazine` / `compact`)
- Settings page: Selectable with preview in the layout section of `/settings/appearance`
- Persistence: `localStorage` (instant reflection) + DB sync (500ms debounced PATCH)
- Layout definitions: `src/data/layouts.ts`
- Hook: `src/hooks/useLayout.ts` (based on `createLocalStorageHook`)
- Skeleton UI: Dedicated skeletons corresponding to each layout
- Thumbnail fallback: articles with no `og_image` show the site favicon filling the thumbnail box (`object-contain`, 6px inset) rather than a small icon centred in an empty frame

### Refreshing

Fetching was reachable only through the sidebar context menus, which nothing
advertises, plus pull-to-refresh on touch devices.

| Control | Where | Scope |
|---|---|---|
| Refresh icon | List header (`Header`'s `rightSlot`, filled by `RefreshButton`) | Follows the route: the feed on `/feeds/:id`, a category's enabled feeds on `/categories/:id`, every enabled feed anywhere else |
| Pull-to-refresh | Article list, touch devices | The feed on `/feeds/:id`; elsewhere a plain list revalidation |
| Context menu → Fetch | Sidebar, per feed or category | The feed, or a category's enabled feeds |

The "every feed" path calls `POST /api/admin/fetch-all` — one request, server-side
concurrency — instead of firing one per feed; `fetchAllFeeds()` in
`src/lib/feed-refresh.ts` reads its SSE stream and sums the per-feed counts.

Settings has no fetch control: the articles a run brings in are not on screen there,
and the list it would refresh is unmounted, so the run looked like it had done nothing.

The refresh icon reports the larger of two numbers: what the run pulled from the
sources, and how many articles the feeds in scope gained between the counts the tab
held and the ones read back afterwards. They differ whenever the server's scheduled
fetch got there first — those articles are new to the reader even though the run
itself found nothing, and reporting only the run's count read as "no new articles"
next to a list that had just grown.

### Day Separators

Article lists are grouped by publication day, each group headed by its date.

| Item | Detail |
|---|---|
| Structure | One `<section>` per day, headed by `DaySeparator`. The header sticks below the app header and the category tabs (which publish their height as `--category-tabs-height`), so the day stays visible while scrolling through it. Sections are what let a header unstick: without them every day's header would pile up at the same offset |
| Label | `Today`, `Yesterday`, then the weekday and date via `Intl.DateTimeFormat` (year added outside the current one). Articles with no `published_at` group under `Undated` |
| Excluded lists | `/likes` and `/history`, ordered by `liked_at` / `read_at`: publication days would not run in order there |
| Grid layouts | Kept flat — sections would break the column flow — with a non-sticky separator spanning the row |

Card timestamps use the same calendar-day count as the separators
(`calendarDaysAgo` in `src/lib/dateFormat.ts`): minutes and hours within today,
whole days beyond it. Counting rolling 24-hour windows instead would put two
articles of the same afternoon in different buckets and contradict the header
above them.

Paging through articles in the reader (arrow keys or swipe) shows the same day as a
full-screen divider when navigation crosses into it — see
[84_feature_keyboard_navigation.md](./84_feature_keyboard_navigation.md).

### PWA Support

Progressive Web App support via `vite-plugin-pwa`.

| Item | Configuration |
|---|---|
| Registration method | `autoUpdate` |
| Display mode | `standalone` |
| Start URL | `/inbox` |
| Cache strategy (Favicon) | CacheFirst (30 days) |
| Cache strategy (Article detail API) | StaleWhileRevalidate (7 days) |
| Cache strategy (General API) | NetworkFirst (24 hours, 5s timeout) |
| Cache strategy (Images) | CacheFirst (30 days) |
| Offline queue | Accumulates unsynced read IDs in IndexedDB (`reader-offline` DB) and batch-syncs via `POST /api/articles/batch-seen` when back online |
| Update notification | When a new service worker is available, a persistent toast ("New version available") with a reload button is displayed via `sonner`. Clicking reload activates the new worker and refreshes the page |

### Custom Theme Import

Users can import custom color themes via JSON in `/settings/appearance`.

| Item | Detail |
|---|---|
| Import method | Paste JSON into syntax-highlighted editor dialog, or load from file |
| Sample theme | "Sample" button loads an Everforest theme as a starting point |
| Edit | Previously imported custom themes can be edited via the same dialog |
| Validation | Theme name must match `[a-z0-9_-]+`, cannot override builtin names, must include both `light` and `dark` variants with all required color keys |
| Max custom themes | 20 |
| Persistence | localStorage + DB sync |
| Required color keys | `background`, `background.sidebar`, `background.subtle`, `background.avatar`, `text`, `text.muted`, `accent`, `accent.text`, `error`, `border`, `hover`, `overlay` |
| Optional fields | `indicatorStyle` (`'line'` / `'dot'`), `highlight` (code block theme, default: `'github'`) |

### Feed Multi-Select and Bulk Actions

Multiple feeds can be selected in the sidebar for bulk operations.

| Item | Detail |
|---|---|
| Select | Cmd/Ctrl + Click to toggle individual feed, Shift + Click for range selection |
| Deselect | Escape key clears selection |
| Exclusion | Clip feeds are excluded from multi-select |
| Context menu | Right-click on selection to open bulk action menu |

Supported bulk actions:

| Action | Behavior |
|---|---|
| Move to Category | `POST /api/feeds/bulk-move` — moves selected feeds to a category |
| Mark All Read | Calls `POST /api/feeds/:id/mark-all-seen` for each feed |
| Fetch | Fetches each selected enabled feed sequentially |
| Delete | Requires confirmation dialog. Deletes each feed via `DELETE /api/feeds/:id` |

### Settings — Feed Management

The `viewer` settings tab (labelled **Feeds**) holds two sections, both reading the `/api/feeds` SWR cache — no extra endpoint is involved.

**Needs attention panel** (`FeedDiagnosticsSection`)

Lists the feeds with `disabled = 1` or a non-null `last_error`, disabled first, then by consecutive failure count.

| Item | Detail |
|---|---|
| Cause | `classifyError()` in `src/lib/feed-error.ts` maps `last_error` to the pipeline stage that failed (discovery / bridge / fetch / parse) and to an explanation. Shared with the article-list error banner |
| Detail | Failed stage, consecutive failure count, last article date, and chips for feeds served through RSS Bridge or behind bot protection. The raw `last_error` string sits behind a disclosure |
| Actions | The remedies the classification suggests — `Re-detect RSS` (`POST /api/feeds/:id/re-detect` as SSE, followed by a fetch) and `Retry Fetch` (`POST /api/feeds/:id/fetch`) — plus `Enable` for disabled feeds (`PATCH /api/feeds/:id` with `disabled: 0`) |
| Retry all | Re-enables and re-fetches every listed feed sequentially, then reports how many recovered. Re-detection is deliberately excluded: it can rewrite a feed's RSS URL |
| Collapse | Past 5 feeds the list collapses behind a "show all" button |
| Healthy | With nothing failing, the panel is a single confirmation line |

**Feed table** (`FeedManagementSection`)

| Item | Detail |
|---|---|
| Rows | One per feed. Clip feeds are excluded |
| Columns | Feed (name + domain), category, article count, unread count, articles per week, last article (relative time), status |
| Status | `error` (last fetch failed), `disabled` (auto-disabled after 5 consecutive failures), `inactive` (no article for 90 days, same rule as the sidebar), `ok`. Hovering a status shows `last_error` |
| Sorting | Any column header. Count and date columns sort descending on first click, text columns ascending |
| Filtering | Free-text search over name and URL, plus category and status dropdowns |
| Adding | An `Add Feed` button in the section header opens the shared `FeedModal` with `initialStep="feed"`, skipping the add-something chooser. On success the table refreshes from the same SWR cache and the new feed's fetch is subscribed to |
| Editing | A pencil per row opens `FeedEditDialog`: name, feed URL (RSS/Atom) and site URL, saved with `PATCH /api/feeds/:id`. A feed whose address moved used to have to be deleted and added again, losing its articles. Saving a URL change fetches the feed at once and reports what it found; a rename alone does not, and a disabled feed is left alone since `POST /api/feeds/:id/fetch` answers 404 for one |
| Selection | Per-row checkbox toggles; Shift + Click selects a range; the header checkbox toggles every row matching the current filters |
| Scope | Bulk actions apply only to selected feeds that the current filters keep visible — a selection hidden by a filter is never acted on |

Bulk actions reuse `useFeedBulkActions` (shared with the sidebar multi-select):

| Action | Behavior |
|---|---|
| Move to Category | `POST /api/feeds/bulk-move` |
| Mark All Read | `POST /api/feeds/:id/mark-all-seen` per feed |
| Re-enable | `PATCH /api/feeds/:id` with `disabled: 0` for each selected disabled feed. Shown only when the selection contains a disabled feed |
| Delete | Requires confirmation dialog. `DELETE /api/feeds/:id` per feed |
