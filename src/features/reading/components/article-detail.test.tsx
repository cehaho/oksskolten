import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { LocaleContext } from '@/i18n'
import { TooltipProvider } from '@/components/ui/tooltip'
import { KeyboardNavigationProvider } from '@/contexts/keyboard-navigation-context'

const { mockApiPatch, mockApiPost, mockTrackRead, mockQueueSeenIds, mockFetcher } = vi.hoisted(() => ({
  mockApiPatch: vi.fn(),
  mockApiPost: vi.fn(() => Promise.resolve()),
  mockTrackRead: vi.fn(),
  mockQueueSeenIds: vi.fn((_ids: number[]) => Promise.resolve()),
  mockFetcher: vi.fn((_key: string): Promise<unknown> => Promise.reject(new Error('no network in tests'))),
}))

vi.mock('@/lib/fetcher', async () => {
  const actual = await vi.importActual<typeof import('@/lib/fetcher')>('@/lib/fetcher')
  return {
    ...actual,
    apiPatch: mockApiPatch,
    apiPost: mockApiPost,
    fetcher: (key: string) => mockFetcher(key),
  }
})

vi.mock('@/lib/readTracker', () => ({
  trackRead: (...args: unknown[]) => mockTrackRead(...args),
}))

vi.mock('@/lib/offlineQueue', () => ({
  queueSeenIds: (ids: number[]) => mockQueueSeenIds(ids),
}))

vi.mock('../hooks/use-rewrite-internal-links', () => ({
  useRewriteInternalLinks: (html: string) => ({ rewrittenHtml: html }),
}))

vi.mock('../hooks/use-metrics', () => ({
  useMetrics: () => ({ metrics: null, report: vi.fn(), reset: vi.fn(), formatMetrics: vi.fn(() => null) }),
}))

vi.mock('../hooks/use-summarize', () => ({
  useSummarize: () => ({
    summary: null,
    summarizing: false,
    streamingText: '',
    handleSummarize: vi.fn(),
    summaryHtml: '',
    streamingHtml: '',
    error: null,
  }),
}))

const mockUseTranslate = vi.fn((_article?: { id: number; full_text_translated: string | null }, _metrics?: unknown) => ({
  viewMode: 'original' as 'original' | 'translated',
  setViewMode: vi.fn(),
  translating: false,
  translatingText: '',
  fullTextTranslated: null as string | null,
  handleTranslate: vi.fn(),
  translatingHtml: '',
  error: null as string | null,
}))

vi.mock('../hooks/use-translate', () => ({
  useTranslate: (...args: Parameters<typeof mockUseTranslate>) => mockUseTranslate(...args),
}))

vi.mock('@/components/ui/image-lightbox', () => ({
  ImageLightbox: () => null,
}))

vi.mock('@/features/chat', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/chat')>()
  return {
    ...actual,
    ChatFab: () => null,
  }
})

import { ArticleDetail } from './article-detail'

beforeEach(() => {
  mockFetcher.mockReset()
  mockFetcher.mockRejectedValue(new Error('no network in tests'))
})

const mockSettings = {
  internalLinks: 'on' as const,
  colorMode: 'system' as const,
  setColorMode: vi.fn(),
  themeName: 'default',
  setTheme: vi.fn(),
  themes: [{ name: 'default', label: 'Default' }],
  dateMode: 'relative' as const,
  setDateMode: vi.fn(),
  autoMarkRead: 'off' as const,
  setAutoMarkRead: vi.fn(),
  showUnreadIndicator: 'on' as const,
  setShowUnreadIndicator: vi.fn(),
  indicatorStyle: 'dot' as const,
  showThumbnails: 'on' as const,
  setShowThumbnails: vi.fn(),
  showFeedActivity: 'on' as const,
  setShowFeedActivity: vi.fn(),
  highlightTheme: 'github-dark' as const,
  setHighlightTheme: vi.fn(),
  articleFont: 'sans' as const,
  setArticleFont: vi.fn(),
  save: vi.fn(),
}

function OutletWrapper() {
  return (
    <KeyboardNavigationProvider>
      <Outlet context={{ settings: mockSettings, sidebarOpen: false, setSidebarOpen: vi.fn() }} />
    </KeyboardNavigationProvider>
  )
}

describe('ArticleDetail bookmark', () => {
  const articleUrl = 'https://example.com/posts/1'
  const articleKey = `/api/articles/by-url?url=${encodeURIComponent(articleUrl)}`
  const article = {
    id: 1,
    feed_id: 2,
    feed_name: 'Example Feed',
    title: 'Example Article',
    url: articleUrl,
    published_at: '2026-03-04T00:00:00.000Z',
    lang: 'en',
    summary: null,
    full_text: 'Body',
    full_text_translated: null,
    translated_lang: null,
    seen_at: '2026-03-04T00:00:00.000Z',
    read_at: '2026-03-04T00:00:00.000Z',
    bookmarked_at: null,
    liked_at: null,
  }

  beforeEach(() => {
    mockApiPatch.mockReset()
    mockApiPatch.mockResolvedValue({ bookmarked_at: '2026-03-05T00:00:00.000Z' })
    mockApiPost.mockReset()
    mockApiPost.mockResolvedValue(undefined)
    mockTrackRead.mockReset()
    mockQueueSeenIds.mockClear()
  })

  it('updates the bookmark button immediately after click', async () => {
    render(
      <MemoryRouter>
        <LocaleContext.Provider value={{ locale: 'fr', setLocale: vi.fn() }}>
          <TooltipProvider>
            <SWRConfig value={{ provider: () => new Map(), fallback: { [articleKey]: article } }}>
              <Routes>
                <Route element={<OutletWrapper />}>
                  <Route path="*" element={<ArticleDetail articleUrl={articleUrl} />} />
                </Route>
              </Routes>
            </SWRConfig>
          </TooltipProvider>
        </LocaleContext.Provider>
      </MemoryRouter>,
    )

    const buttons = screen.getAllByRole('button', { pressed: false })
    // First aria-pressed button is bookmark, second is like
    const bookmarkBtn = buttons[0]
    const icon = bookmarkBtn.querySelector('svg')
    expect(icon?.getAttribute('fill')).toBe('none')

    fireEvent.click(bookmarkBtn)

    await waitFor(() => {
      expect(screen.getAllByRole('button', { pressed: true })).toHaveLength(1)
    })
    expect(bookmarkBtn.querySelector('svg')?.getAttribute('fill')).toBe('currentColor')
    expect(mockApiPatch).toHaveBeenCalledWith('/api/articles/1/bookmark', { bookmarked: true })
  })
})

describe('ArticleDetail like', () => {
  const articleUrl = 'https://example.com/posts/1'
  const articleKey = `/api/articles/by-url?url=${encodeURIComponent(articleUrl)}`
  const article = {
    id: 1,
    feed_id: 2,
    feed_name: 'Example Feed',
    title: 'Example Article',
    url: articleUrl,
    published_at: '2026-03-04T00:00:00.000Z',
    lang: 'en',
    summary: null,
    full_text: 'Body',
    full_text_translated: null,
    translated_lang: null,
    seen_at: '2026-03-04T00:00:00.000Z',
    read_at: '2026-03-04T00:00:00.000Z',
    bookmarked_at: null,
    liked_at: null,
  }

  beforeEach(() => {
    mockApiPatch.mockReset()
    mockApiPatch.mockResolvedValue({ liked_at: '2026-03-05T00:00:00.000Z' })
    mockApiPost.mockReset()
    mockApiPost.mockResolvedValue(undefined)
    mockTrackRead.mockReset()
    mockQueueSeenIds.mockClear()
  })

  beforeEach(() => {
    mockUseTranslate.mockClear()
  })

  it('updates the like button immediately after click', async () => {
    render(
      <MemoryRouter>
        <LocaleContext.Provider value={{ locale: 'fr', setLocale: vi.fn() }}>
          <TooltipProvider>
            <SWRConfig value={{ provider: () => new Map(), fallback: { [articleKey]: article } }}>
              <Routes>
                <Route element={<OutletWrapper />}>
                  <Route path="*" element={<ArticleDetail articleUrl={articleUrl} />} />
                </Route>
              </Routes>
            </SWRConfig>
          </TooltipProvider>
        </LocaleContext.Provider>
      </MemoryRouter>,
    )

    const buttons = screen.getAllByRole('button', { pressed: false })
    // First aria-pressed button is bookmark, second is like
    const likeBtn = buttons[1]
    const icon = likeBtn.querySelector('svg')
    expect(icon?.getAttribute('fill')).toBe('none')

    fireEvent.click(likeBtn)

    await waitFor(() => {
      const pressedButtons = screen.getAllByRole('button', { pressed: true })
      expect(pressedButtons).toHaveLength(1)
    })
    expect(likeBtn.querySelector('svg')?.getAttribute('fill')).toBe('currentColor')
    expect(mockApiPatch).toHaveBeenCalledWith('/api/articles/1/like', { liked: true })
  })

})

describe('ArticleDetail stale translation filtering', () => {
  const articleUrl = 'https://example.com/posts/1'
  const articleKey = `/api/articles/by-url?url=${encodeURIComponent(articleUrl)}`

  beforeEach(() => {
    mockApiPatch.mockReset()
    mockApiPost.mockReset()
    mockApiPost.mockResolvedValue(undefined)
    mockTrackRead.mockReset()
    mockQueueSeenIds.mockClear()
    mockUseTranslate.mockClear()
  })

  it('passes full_text_translated: null when translated_lang does not match locale', () => {
    const article = {
      id: 1,
      feed_id: 2,
      feed_name: 'Example Feed',
      title: 'Example Article',
      url: articleUrl,
      published_at: '2026-03-04T00:00:00.000Z',
      lang: 'fr',
      summary: null,
      full_text: 'Contenu français',
      full_text_translated: 'Ancienne traduction française',
      translated_lang: 'fr',
      seen_at: '2026-03-04T00:00:00.000Z',
      read_at: '2026-03-04T00:00:00.000Z',
      bookmarked_at: null,
      liked_at: null,
    }

    render(
      <MemoryRouter>
        <LocaleContext.Provider value={{ locale: 'en', setLocale: vi.fn() }}>
          <TooltipProvider>
            <SWRConfig value={{ provider: () => new Map(), fallback: { [articleKey]: article } }}>
              <Routes>
                <Route element={<OutletWrapper />}>
                  <Route path="*" element={<ArticleDetail articleUrl={articleUrl} />} />
                </Route>
              </Routes>
            </SWRConfig>
          </TooltipProvider>
        </LocaleContext.Provider>
      </MemoryRouter>,
    )

    // translated_lang='fr' but locale='en' → stale, should pass null
    expect(mockUseTranslate).toHaveBeenCalled()
    const firstArg = mockUseTranslate.mock.calls[0]![0]
    expect(firstArg).toEqual({ id: 1, full_text_translated: null })
  })

  it('passes full_text_translated when translated_lang matches locale', () => {
    const article = {
      id: 1,
      feed_id: 2,
      feed_name: 'Example Feed',
      title: 'Example Article',
      url: articleUrl,
      published_at: '2026-03-04T00:00:00.000Z',
      lang: 'fr',
      summary: null,
      full_text: 'Contenu français',
      full_text_translated: '日本語訳',
      translated_lang: 'fr',
      seen_at: '2026-03-04T00:00:00.000Z',
      read_at: '2026-03-04T00:00:00.000Z',
      bookmarked_at: null,
      liked_at: null,
    }

    render(
      <MemoryRouter>
        <LocaleContext.Provider value={{ locale: 'fr', setLocale: vi.fn() }}>
          <TooltipProvider>
            <SWRConfig value={{ provider: () => new Map(), fallback: { [articleKey]: article } }}>
              <Routes>
                <Route element={<OutletWrapper />}>
                  <Route path="*" element={<ArticleDetail articleUrl={articleUrl} />} />
                </Route>
              </Routes>
            </SWRConfig>
          </TooltipProvider>
        </LocaleContext.Provider>
      </MemoryRouter>,
    )

    // translated_lang='fr' and locale='fr' → current, should pass the translation
    expect(mockUseTranslate).toHaveBeenCalled()
    const firstArg = mockUseTranslate.mock.calls[0]![0]
    expect(firstArg).toEqual({ id: 1, full_text_translated: '日本語訳' })
  })

  it('passes full_text_translated: null when translated_lang is null', () => {
    const article = {
      id: 1,
      feed_id: 2,
      feed_name: 'Example Feed',
      title: 'Example Article',
      url: articleUrl,
      published_at: '2026-03-04T00:00:00.000Z',
      lang: 'fr',
      summary: null,
      full_text: 'Contenu français',
      full_text_translated: 'legacy translation',
      translated_lang: null,
      seen_at: '2026-03-04T00:00:00.000Z',
      read_at: '2026-03-04T00:00:00.000Z',
      bookmarked_at: null,
      liked_at: null,
    }

    render(
      <MemoryRouter>
        <LocaleContext.Provider value={{ locale: 'fr', setLocale: vi.fn() }}>
          <TooltipProvider>
            <SWRConfig value={{ provider: () => new Map(), fallback: { [articleKey]: article } }}>
              <Routes>
                <Route element={<OutletWrapper />}>
                  <Route path="*" element={<ArticleDetail articleUrl={articleUrl} />} />
                </Route>
              </Routes>
            </SWRConfig>
          </TooltipProvider>
        </LocaleContext.Provider>
      </MemoryRouter>,
    )

    // translated_lang=null (legacy) → stale, should pass null
    expect(mockUseTranslate).toHaveBeenCalled()
    const firstArg = mockUseTranslate.mock.calls[0]![0]
    expect(firstArg).toEqual({ id: 1, full_text_translated: null })
  })
})

describe('ArticleDetail title translation', () => {
  const articleUrl = 'https://example.com/posts/1'
  const articleKey = `/api/articles/by-url?url=${encodeURIComponent(articleUrl)}`

  const baseArticle = {
    id: 1,
    feed_id: 2,
    feed_name: 'Example Feed',
    title: 'Original Title',
    title_translated: 'Titre traduit',
    url: articleUrl,
    published_at: '2026-03-04T00:00:00.000Z',
    lang: 'en',
    summary: null,
    full_text: 'Body',
    full_text_translated: null as string | null,
    translated_lang: null as string | null,
    seen_at: '2026-03-04T00:00:00.000Z',
    read_at: '2026-03-04T00:00:00.000Z',
    bookmarked_at: null,
    liked_at: null,
  }

  beforeEach(() => {
    mockApiPatch.mockReset()
    mockApiPost.mockReset()
    mockApiPost.mockResolvedValue(undefined)
    mockTrackRead.mockReset()
    mockQueueSeenIds.mockClear()
    mockUseTranslate.mockClear()
  })

  function renderWithArticle(article: typeof baseArticle) {
    render(
      <MemoryRouter>
        <LocaleContext.Provider value={{ locale: 'fr', setLocale: vi.fn() }}>
          <TooltipProvider>
            <SWRConfig value={{ provider: () => new Map(), fallback: { [articleKey]: article } }}>
              <Routes>
                <Route element={<OutletWrapper />}>
                  <Route path="*" element={<ArticleDetail articleUrl={articleUrl} />} />
                </Route>
              </Routes>
            </SWRConfig>
          </TooltipProvider>
        </LocaleContext.Provider>
      </MemoryRouter>,
    )
  }

  it('shows the translated title when only the title was auto-translated (no body translation)', () => {
    mockUseTranslate.mockReturnValue({
      viewMode: 'original',
      setViewMode: vi.fn(),
      translating: false,
      translatingText: '',
      fullTextTranslated: null,
      handleTranslate: vi.fn(),
      translatingHtml: '',
      error: null,
    })

    renderWithArticle(baseArticle)

    expect(screen.getByText('Titre traduit')).toBeTruthy()
    expect(screen.queryByText('Original Title')).toBeNull()
  })

  it('shows the original title when viewing the original body of a fully-translated article', () => {
    mockUseTranslate.mockReturnValue({
      viewMode: 'original',
      setViewMode: vi.fn(),
      translating: false,
      translatingText: '',
      fullTextTranslated: 'Corps traduit',
      handleTranslate: vi.fn(),
      translatingHtml: '',
      error: null,
    })

    renderWithArticle({ ...baseArticle, full_text_translated: 'Corps traduit', translated_lang: 'fr' })

    expect(screen.getByText('Original Title')).toBeTruthy()
    expect(screen.queryByText('Titre traduit')).toBeNull()
  })

  it('shows the translated title when viewing the translated body of a fully-translated article', () => {
    mockUseTranslate.mockReturnValue({
      viewMode: 'translated',
      setViewMode: vi.fn(),
      translating: false,
      translatingText: '',
      fullTextTranslated: 'Corps traduit',
      handleTranslate: vi.fn(),
      translatingHtml: '',
      error: null,
    })

    renderWithArticle({ ...baseArticle, full_text_translated: 'Corps traduit', translated_lang: 'fr' })

    expect(screen.getByText('Titre traduit')).toBeTruthy()
    expect(screen.queryByText('Original Title')).toBeNull()
  })

  // Browsers cached the empty answers the image route once sent, for a year
  it('loads archived images under a versioned URL', () => {
    mockUseTranslate.mockReturnValue({
      viewMode: 'original',
      setViewMode: vi.fn(),
      translating: false,
      translatingText: '',
      fullTextTranslated: null,
      handleTranslate: vi.fn(),
      translatingHtml: '',
      error: null,
    })

    renderWithArticle({ ...baseArticle, full_text: '![](/api/articles/images/1_abcdef012345.png)\n\nBody' })

    const img = document.querySelector('.prose img')
    expect(img?.getAttribute('src')).toMatch(/^\/api\/articles\/images\/1_abcdef012345\.png\?v=\d+$/)
  })
})

describe('ArticleDetail empty body recovery', () => {
  const articleUrl = 'https://example.com/posts/clipped'
  const articleKey = `/api/articles/by-url?url=${encodeURIComponent(articleUrl)}`

  const baseArticle = {
    id: 7,
    feed_id: 3,
    feed_name: 'Clips',
    title: 'Clipped Article',
    url: articleUrl,
    published_at: '2026-03-04T00:00:00.000Z',
    lang: 'en',
    summary: null,
    full_text: null as string | null,
    full_text_translated: null as string | null,
    translated_lang: null as string | null,
    seen_at: '2026-03-04T00:00:00.000Z',
    read_at: '2026-03-04T00:00:00.000Z',
    bookmarked_at: null,
    liked_at: null,
  }

  beforeEach(() => {
    mockApiPatch.mockReset()
    mockApiPost.mockReset()
    mockApiPost.mockResolvedValue(undefined)
    mockTrackRead.mockReset()
    mockQueueSeenIds.mockClear()
    mockUseTranslate.mockClear()
    mockUseTranslate.mockReturnValue({
      viewMode: 'original',
      setViewMode: vi.fn(),
      translating: false,
      translatingText: '',
      fullTextTranslated: null,
      handleTranslate: vi.fn(),
      translatingHtml: '',
      error: null,
    })
  })

  // The app disables SWR revalidation globally, so these tests reproduce that
  // config: without it SWR would refetch on mount anyway and prove nothing.
  function renderCached(article: typeof baseArticle) {
    render(
      <MemoryRouter>
        <LocaleContext.Provider value={{ locale: 'fr', setLocale: vi.fn() }}>
          <TooltipProvider>
            <SWRConfig
              value={{
                provider: () => new Map(),
                revalidateOnFocus: false,
                revalidateIfStale: false,
                revalidateOnReconnect: false,
                fallback: { [articleKey]: article },
              }}
            >
              <Routes>
                <Route element={<OutletWrapper />}>
                  <Route path="*" element={<ArticleDetail articleUrl={articleUrl} />} />
                </Route>
              </Routes>
            </SWRConfig>
          </TooltipProvider>
        </LocaleContext.Provider>
      </MemoryRouter>,
    )
  }

  // Other keys (the chat panel) go through the same fetcher, so count only
  // the requests aimed at this article.
  function articleFetchCount() {
    return mockFetcher.mock.calls.filter(([key]) => key === articleKey).length
  }

  function serveArticle(article: unknown) {
    mockFetcher.mockImplementation((key: string) =>
      key === articleKey ? Promise.resolve(article) : Promise.reject(new Error('no network in tests')))
  }

  it('refetches an article whose body is still empty, and shows the recovered text', async () => {
    serveArticle({ ...baseArticle, full_text: 'Recovered body text' })

    renderCached(baseArticle)

    await waitFor(() => {
      expect(screen.getByText('Recovered body text')).toBeTruthy()
    })
    expect(articleFetchCount()).toBe(1)
  })

  it('refetches only once when the body is still empty on the server', async () => {
    serveArticle({ ...baseArticle })

    renderCached(baseArticle)

    await waitFor(() => {
      expect(articleFetchCount()).toBe(1)
    })
    // Give a re-render pass a chance to fire a second request before asserting.
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(articleFetchCount()).toBe(1)
  })

  it('does not refetch an article that already has a body', async () => {
    serveArticle({ ...baseArticle, full_text: 'Already here' })

    renderCached({ ...baseArticle, full_text: 'Already here' })

    expect(screen.getByText('Already here')).toBeTruthy()
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(articleFetchCount()).toBe(0)
  })
})
