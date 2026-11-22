# Oksskolten Spec — Video Archive

> [Back to Overview](./01_overview.md)

## Overview

Keep a copy of the video an article embeds, so the article stays complete after
the source takes the video down. The sibling of the
[image archive](./81_feature_images.md), and deliberately the same shape:
requested per article, processed in the background, served from this instance,
deleted with the article.

## Motivation

The reader already survives its sources: `full_text` is stored, and images can
be archived locally. An embedded video was the hole in that — the article
outlived the video it was written around.

Two things make video different from images, both consequences of size.

**It is never automatic.** Images are archived on request but cheaply enough
that archiving everything would be defensible. A video is three orders of
magnitude larger, so archiving stays a deliberate act on one article.

**It cannot be fetched.** A provider page serves a player, not a file, so the
download shells out to `yt-dlp`. That is an external binary the providers break
every few months and which has to be kept updated. When it is missing or fails,
the article is left exactly as it was.

## Design

### Prerequisite: the video must exist in the article

Extraction writes an embed into the stored Markdown as a poster linking to the
video (see the `videoEmbed` Turndown rule in `server/fetcher/contentWorker.ts`,
and `shared/video.ts` for which URLs count as videos). Before that rule existed
the embed was dropped at conversion, so there was nothing to archive.

### Flow

```
Reader presses "Archive video" on one article
    │
    ▼
POST /api/articles/:id/archive-video
    │
    ├─ 400 if archiving is disabled, the article has no full_text,
    │      or findArchivableVideos() finds nothing to fetch
    ├─ 409 if videos_archived_at is already set
    ├─ 202 accepted — the reply does not wait, a download runs for minutes
    │
    ▼ background
archiveArticleVideos(articleId, fullText)
    ├─ for each video the Markdown points at:
    │   ├─ yt-dlp -f "best[height<=?H][ext=mp4]/best[height<=?H]/best"
    │   │       --max-filesize {S}m -o {videosDir}/{articleId}_{hash}.mp4
    │   ├─ the file's existence is the success signal: yt-dlp exits 0 without
    │   │   writing anything when the video is over --max-filesize
    │   └─ swap the Markdown card for <video controls preload="none" …>
    └─ mark videos_archived_at, but only if something landed
```

Errors are counted, never thrown: one video that refuses to download must not
cost the reader the others, nor the article's text. The article is only
rewritten for videos that actually landed.

`videos_archived_at` is likewise set only when at least one download succeeded.
The flag hides the archive control and makes the endpoint answer `409`, so
setting it after a failed download would lock the article out of ever being
retried — and this download fails for reasons that get fixed later: a missing
JS runtime, a yt-dlp the providers have broken, a network blip. This is where
video parts company with images, whose per-image failures are partial and
routine.

### Serving

`GET /api/articles/videos/:filename` mirrors the image route's path-traversal
checks and adds byte ranges, which images do not need: `<video>` seeks by asking
for a range, and a server that ignores them gives the reader a clip it can only
watch from the start. `parseByteRange()` handles `bytes=a-b`, `bytes=a-`, and
`bytes=-n`, clamps an end past the last byte, and returns null for anything
unsatisfiable or multipart — answered with `416` and `Content-Range: bytes */size`.

It also mirrors the image route's authentication: `<video>` loads the file
itself and cannot send the `Authorization` header, so the route runs
`requireMediaAuth` and accepts the `media_token` cookie
(`docs/spec/40_auth.md`).

Both answers stream the file and return the reply, like the image route: sent
without the return, the stream lost to the empty body Fastify sends for an async
handler that resolves with `undefined`, and the player received nothing. The
reader adds the same version query as for images (`versionArchivedMediaUrls()`)
so caches holding those empty answers are bypassed.

### No CSP change

An archived video is served from this origin, and `default-src 'self'` covers
`media-src`, so it plays with no CSP change. Embedding the provider's player
instead would have required `frame-src`, which the policy does not grant — the
archive is, unusually, the cheaper of the two.

### Settings

| Setting | Default | Purpose |
|---|---|---|
| `videos.enabled` | off | Whether the article toolbar offers the control at all |
| `videos.max_height` | 720 | Height ceiling. The lever images do not have: 720p turns a ten-minute talk from near a gigabyte into near a hundred megabytes |
| `videos.max_size_mb` | 500 | Refuse a download larger than this outright |
| `videos.storage_path` | `data/articles/videos` | Where the files live |
| `videos.downloader` / `YT_DLP_PATH` | `yt-dlp` | Path to the downloader binary |

Local storage only. The image archive's remote-upload mode is aimed at image
hosts; posting hundreds of megabytes to one is not a thing.

### Deletion

When an article is deleted and `videos_archived_at` is set,
`deleteArticleVideos(articleId)` removes every `{articleId}_*` file in the
videos directory — the same rule as images, and worth more disk.
