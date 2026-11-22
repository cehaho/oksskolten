import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Piscina as PiscinaPool } from 'piscina'
import { JSDOM } from 'jsdom'
import { fetchHtml, DEFAULT_TIMEOUT } from './http.js'
import { resolveGoogleNewsUrl, isGoogleNewsUrl } from './google-news.js'
import { fetchViaFlareSolverr } from './flaresolverr.js'
import { findEmbeddedContentUrl, type EmbeddedContent } from './embedded-content.js'
import { fetchRedditPostContent } from './reddit.js'
import type { CleanerConfig } from '../lib/cleaner/selectors.js'
import type { ParseHtmlInput, ParseHtmlResult } from './contentWorker.js'

// Worker pool for CPU-intensive DOM parsing (jsdom + Readability + Turndown).
// Runs on separate threads so the main event loop stays responsive for API requests.
//
// Resolve the worker file by checking the filesystem rather than branching on
// NODE_ENV. The compiled .js exists only in production builds (dist-server/),
// while the .ts source is what's on disk under tsx dev. tsx's loader hooks
// don't intercept the Worker entry-point URL — it must point at a file that
// actually exists.
//
// JSDOM allocates 3-4 instances per parse, so each worker needs heap headroom
// for heavy pages (Reuters, Medium-class sites with large inline scripts).
// Use Worker resourceLimits.maxOldGenerationSizeMb instead of putting
// --max-old-space-size in execArgv: Node validates worker execArgv and rejects
// V8 memory flags.
const jsWorkerUrl = new URL('./contentWorker.js', import.meta.url)
const tsWorkerUrl = new URL('./contentWorker.ts', import.meta.url)
const workerUrl = fs.existsSync(fileURLToPath(jsWorkerUrl)) ? jsWorkerUrl : tsWorkerUrl

/**
 * Factory for the Piscina worker pool. Exported so integration tests can
 * spawn an isolated pool without colliding with the production-side
 * singleton in `getPool()`. Production code must always go through
 * `getPool()`, not call this directly, to avoid duplicate pools.
 */
export function createWorkerPool(): PiscinaPool {
  return new PiscinaPool({
    filename: workerUrl.href,
    execArgv: process.execArgv,
    resourceLimits: {
      maxOldGenerationSizeMb: 512,
    },
    maxThreads: Number(process.env.PARSE_MAX_THREADS) || 2,
    // Keep at least one warm worker. minThreads: 0 forced a cold spawn for the
    // first task in every sparse batch; the spawn-plus-parse latency could
    // approach the per-task timeout under load.
    minThreads: 1,
    idleTimeout: 30_000,
  })
}

let _pool: PiscinaPool | null = null

function getPool(): PiscinaPool {
  if (!_pool) _pool = createWorkerPool()
  return _pool
}

/** Per-task timeout for worker pool. */
const WORKER_TIMEOUT_MS = 45_000

/**
 * Run a worker task with a cancellable timeout. Unlike AbortSignal.timeout(),
 * the underlying timer is cleared once the task settles, so the abort listener
 * never fires after the promise resolves. Without this, Piscina's internal
 * abort cleanup occasionally produced unhandled-rejection noise long after
 * the batch had completed.
 */
async function runWithTimeout(input: ParseHtmlInput, timeoutMs: number): Promise<ParseHtmlResult> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(new Error('Worker timeout')), timeoutMs)
  try {
    return await getPool().run(input, { signal: controller.signal })
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Minimum character count for extracted article text to be considered valid.
 * Shared between fetchFullText (FlareSolverr retry) and fetchArticleContent (RSS fallback).
 */
export const MIN_EXTRACTED_LENGTH = 200

/**
 * Strip heavy non-content tags before passing HTML to the worker thread.
 * This runs on the main thread with simple regex (no DOM parsing), so it's fast.
 * Removes clearly non-content shells before Readability to reduce parse time.
 */
export function stripHeavyTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '')
    .replace(/<dialog[\s\S]*?<\/dialog>/gi, '')
    .replace(/<form[\s\S]*?<\/form>/gi, '')
    .replace(/<template[\s\S]*?<\/template>/gi, '')
    .replace(/<canvas[\s\S]*?<\/canvas>/gi, '')
}

function isHeading(el: Element): el is HTMLElement {
  return /^H[1-6]$/i.test(el.tagName)
}

function headingLevel(el: Element | null): number {
  if (!el) return 6
  if (isHeading(el)) return Number(el.tagName[1])
  if (el.getAttribute('role') === 'heading') {
    const ariaLevel = Number(el.getAttribute('aria-level') || '6')
    return Number.isFinite(ariaLevel) && ariaLevel > 0 ? ariaLevel : 6
  }
  return 6
}

function isBoundaryHeading(el: Element, targetLevel: number): boolean {
  return headingLevel(el) <= targetLevel
}

/**
 * For anchor-link documents like changelogs, extract only the targeted section.
 * This avoids sending the entire page history to jsdom + Readability.
 */
export function extractAnchoredContentHtml(html: string, articleUrl: string): string {
  const url = new URL(articleUrl)
  const hash = url.hash.replace(/^#/, '')
  if (!hash) return html

  const dom = new JSDOM(html, { url: articleUrl })
  const doc = dom.window.document
  const target = doc.getElementById(hash)
  if (!target) return html

  const start = isHeading(target) ? target : (target as Element).closest('h1, h2, h3, h4, h5, h6, [role="heading"]') || target
  const targetLevel = headingLevel(start)

  let endBoundary: Element | null = null
  let current: Element | null = start
  while ((current = current!.nextElementSibling)) {
    if (isBoundaryHeading(current, targetLevel)) {
      endBoundary = current
      break
    }
  }

  const range = doc.createRange()
  range.setStartBefore(start)
  if (endBoundary) range.setEndBefore(endBoundary)
  else range.setEndAfter(doc.body.lastElementChild || doc.body)

  const fragment = doc.createElement('article')
  fragment.append(range.cloneContents())
  const fragmentHtml = fragment.innerHTML.trim()
  if (!fragmentHtml) return html

  const ogTags = [
    doc.querySelector('meta[property="og:image"]')?.outerHTML,
    doc.querySelector('meta[property="og:title"]')?.outerHTML,
  ].filter(Boolean).join('\n')
  const title = doc.querySelector('title')?.textContent || ''

  return `<!DOCTYPE html>
<html>
<head>
<title>${title}</title>
${ogTags}
</head>
<body>
<article>
${fragmentHtml}
</article>
</body>
</html>`
}

export interface FetchFullTextOptions {
  cleanerConfig?: CleanerConfig
  requiresJsChallenge?: boolean
}

export async function fetchFullText(url: string, options?: FetchFullTextOptions): Promise<ParseHtmlResult> {
  const cleanerConfig = options?.cleanerConfig
  const requiresJsChallenge = options?.requiresJsChallenge ?? false

  // Google News feeds link to a wrapper that holds no article text, only a
  // redirect to the publisher. Resolve it first so everything below reads the
  // real page; the article keeps its wrapper URL, which still works in a browser.
  //
  // When Google cannot be made to say where the wrapper points, fail rather
  // than read the wrapper: its shell yields a few words of chrome, which would
  // be stored as the body and keep the article out of the retry queue.
  const resolved = await resolveGoogleNewsUrl(url)
  if (!resolved && isGoogleNewsUrl(url)) {
    throw new Error('Could not resolve Google News link to its publisher')
  }
  const articleUrl = resolved ?? url

  // Reddit posts: build content from the public JSON — the selftext is
  // already Markdown, and crossposted parents are invisible to HTML
  // extraction. Falls through to the regular pipeline on failure.
  const redditPost = await fetchRedditPostContent(articleUrl)
  if (redditPost) {
    // A link post holds no text of its own: the article is on the site it
    // points to, and extracting the Reddit page returns its cookie banner
    // instead. Extract at the destination, keeping the post's own title — the
    // one the reader saw in the feed — and keep the stub body when that fails.
    if (redditPost.linkUrl) {
      const followed = await fetchFullText(redditPost.linkUrl, options).catch(() => null)
      const followedLen = followed ? textLength(followed.fullText) : 0
      if (followed && followedLen >= MIN_EXTRACTED_LENGTH && !isGarbageExtraction(followed.fullText)) {
        return {
          ...followed,
          title: redditPost.title || followed.title,
          ogImage: followed.ogImage || redditPost.ogImage,
        }
      }
    }
    return {
      fullText: redditPost.fullText,
      ogImage: redditPost.ogImage,
      excerpt: redditPost.excerpt,
      title: redditPost.title,
    }
  }

  // Step 1: Fetch HTML (async I/O, non-blocking — stays on main thread)
  const { html } = await fetchHtml(articleUrl, { useFlareSolverr: requiresJsChallenge })

  // Step 2: Parse HTML in worker thread (CPU-intensive, off main thread).
  //
  // Readability throws outright when a page holds nothing to extract, which is
  // precisely the shape of a page whose text lives somewhere else. Hold that
  // error instead of propagating it so the fallbacks below still get their
  // turn, and rethrow only if none of them find anything either.
  let result: ParseHtmlResult | null = null
  let parseError: unknown = null
  try {
    result = await parseFrom(html, articleUrl, cleanerConfig)
  } catch (err) {
    parseError = err
  }

  const extractedLen = result ? textLength(result.fullText) : 0
  const needsRetry = !result || extractedLen < MIN_EXTRACTED_LENGTH || isGarbageExtraction(result.fullText)
  if (result && !needsRetry) return result

  // Step 3: the words may not be on this page at all — held inside an iframe
  // (a Hugging Face Space, a document viewer) or one meta refresh / AMP link
  // away. Tried before the solver: it costs a single plain fetch, and the
  // solver cannot help here anyway, since rendering a shell page still leaves
  // the text inside the frame.
  const embedded = findEmbeddedContentUrl(html, articleUrl)
  if (embedded) {
    const followed = await followEmbeddedContent(embedded, result, extractedLen, cleanerConfig)
    if (followed) return followed
  }

  // Step 4: FlareSolverr fallback if extracted text is too short or looks like garbage
  if (!requiresJsChallenge) {
    const flare = await fetchViaFlareSolverr(articleUrl, {
      waitForSelector: 'article, main, [role="main"], .post-content, .entry-content',
    })
    if (flare) {
      const flareResult = await parseFrom(flare.body, articleUrl, cleanerConfig).catch(() => null)
      if (flareResult && textLength(flareResult.fullText) > extractedLen) {
        return flareResult
      }
    }
  }

  // A shell whose iframe we could not follow is not an article. Returning its
  // chrome — "Fetching metadata…", "Refreshing" — would store a few dozen
  // characters as the body. Clips retry short bodies; RSS articles would sit
  // forever, because their retry queue still requires full_text IS NULL.
  if (embedded && extractedLen < MIN_EXTRACTED_LENGTH) {
    throw parseError instanceof Error
      ? parseError
      : new Error('Could not extract embedded article')
  }

  // A bot-protection page is not an article. Returning it would store the
  // block notice as the body and hide the failure from the reader; throwing
  // records the error, keeps full_text empty and queues the article for retry.
  if (result && isBotBlockPage(result.fullText)) {
    throw new BlockedPageError(articleUrl)
  }
  if (result) return result
  throw parseError instanceof Error ? parseError : new Error(String(parseError))
}

/** The site answered with a bot-protection / block page instead of the article. */
export class BlockedPageError extends Error {
  constructor(url: string) {
    super(`${BLOCKED_ERROR_PREFIX} ${new URL(url).hostname} served a bot-protection page instead of the article`)
    this.name = 'BlockedPageError'
  }
}

/** Prefix of the stored last_error for blocked pages, matched by the UI. */
export const BLOCKED_ERROR_PREFIX = 'blocked:'

/** Trimmed length of extracted text — the measure every fallback is judged on. */
function textLength(text: string): number {
  return text.replace(/\s+/g, ' ').trim().length
}

/** Clean one page's HTML and run the extraction worker over it. */
async function parseFrom(
  html: string,
  articleUrl: string,
  cleanerConfig?: CleanerConfig,
): Promise<ParseHtmlResult> {
  const input: ParseHtmlInput = {
    html: stripHeavyTags(extractAnchoredContentHtml(html, articleUrl)),
    articleUrl,
    cleanerConfig,
  }
  return runWithTimeout(input, WORKER_TIMEOUT_MS)
}

/**
 * Follow the page's pointer to where its text lives and extract there.
 *
 * Returns null unless the hop actually beat what the outer page gave us, so a
 * wrong guess costs one fetch and never a wrong article. Only one hop is taken:
 * this parses the target directly rather than recursing through fetchFullText.
 */
async function followEmbeddedContent(
  embedded: EmbeddedContent,
  outer: ParseHtmlResult | null,
  outerLen: number,
  cleanerConfig?: CleanerConfig,
): Promise<ParseHtmlResult | null> {
  let result: ParseHtmlResult
  try {
    // This is the article, not a cheap discovery probe: Hugging Face Spaces
    // and document viewers routinely serve megabytes of HTML, and a sleeping
    // Space can spend most of DEFAULT_TIMEOUT just waking up. DISCOVERY_TIMEOUT
    // (10s) aborted those downloads and left the clip holding the shell.
    const { html } = await fetchHtml(embedded.url, { timeout: DEFAULT_TIMEOUT })
    result = await parseFrom(html, embedded.url, cleanerConfig)
  } catch {
    return null
  }
  // The hop has to clear the same bar as any other extraction: more text than
  // the outer page gave us, and enough of it to be an article. A frame that
  // yields a loading message is not an improvement, and accepting it would rob
  // the solver fallback below of its turn.
  const followedLen = textLength(result.fullText)
  if (followedLen <= outerLen || followedLen < MIN_EXTRACTED_LENGTH) return null

  // An iframe holds the article without being it: the page the reader linked
  // keeps its own title and preview image. A meta refresh or an AMP link, by
  // contrast, points at the article's own page, which carries its own.
  return embedded.kind === 'iframe'
    ? { ...result, title: outer?.title || result.title, ogImage: outer?.ogImage || result.ogImage }
    : result
}

/**
 * Detect garbage extraction: text that is mostly code/scripts with little natural prose.
 * Strips markdown code fences and checks if remaining text has enough prose sentences.
 * A legitimate blog post about JS has explanatory sentences outside code blocks;
 * garbage extraction from leaked scripts has almost none.
 */
function isGarbageExtraction(text: string): boolean {
  // Bot detection / form submission pages
  if (isBotBlockPage(text)) return true

  // Strip markdown code blocks (```...```)
  const withoutCodeBlocks = text.replace(/```[\s\S]*?```/g, '')
  // Strip inline code (`...`)
  const withoutInlineCode = withoutCodeBlocks.replace(/`[^`]+`/g, '')

  const prose = withoutInlineCode.replace(/\s+/g, ' ').trim()
  if (prose.length === 0) return true

  // Count prose sentences: sequences ending with sentence-final punctuation
  // that contain at least a few word-like tokens
  const sentences = prose.match(/[^.!?。！？]+[.!?。！？]/g) || []
  const proseSentences = sentences.filter(s => {
    const words = s.trim().split(/\s+/)
    return words.length >= 3
  })

  // A real article should have at least a handful of prose sentences
  if (proseSentences.length < 3) return true

  // Check ratio: if prose (outside code fences) is tiny relative to total text, likely garbage
  if (prose.length < text.length * 0.1) return true

  return false
}

const COOKIE_WALL_MAX_LENGTH = 2000
const COOKIE_WALL_PATTERNS = [
  'paramétrez vos cookies',
  'gérer vos cookies',
  'nous utilisons des cookies',
  'we use cookies',
  'manage your cookie',
]

/** Detect bot-block / form-submission pages that Readability mistakenly extracts. */
export function isBotBlockPage(text: string): boolean {
  const lower = text.toLowerCase()
  const patterns = [
    'your submission has been received',
    'something went wrong while submitting',
    'please verify you are a human',
    'checking your browser',
    'enable javascript and cookies',
    'just a moment',
    'attention required',
    'access denied',
    // Reddit's IP-reputation block ("You've been blocked by network security")
    'blocked by network security',
    'file a ticket below',
  ]
  if (patterns.some(p => lower.includes(p))) return true
  // A cookie consent wall extracted in place of the article. Real articles can
  // carry the same wording in a trailing notice, so only a short text counts.
  return text.length < COOKIE_WALL_MAX_LENGTH && COOKIE_WALL_PATTERNS.some(p => lower.includes(p))
}

// Re-export markdown utilities so existing import sites don't break.
// These live in a separate file to avoid circular dependency: contentWorker.ts
// imports from here, but content.ts creates the Piscina pool that loads contentWorker.ts.
export { convertHtmlToMarkdown, markdownToExcerpt, ensureLeadImage } from './markdown-utils.js'
