import { BrowserRouter, Routes, Route, Navigate, Outlet, useParams, useLocation, useNavigate, useOutletContext } from 'react-router-dom'
import { useState, useMemo, useRef, useEffect, useLayoutEffect, useCallback, lazy, Suspense } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import useSWR, { SWRConfig } from 'swr'
import { useSettings, type Settings } from '@/hooks/preferences'
import { fetcher } from './lib/fetcher'
import { LocaleContext, APP_NAME, type Locale, useI18n, isLocale, browserLocale } from '@/i18n'
import { MD_BREAKPOINT } from './lib/breakpoints'
import { useIsTouchDevice } from './hooks/use-is-touch-device'
import { saveScrollPosition, restoreScrollPosition } from './hooks/use-scroll-restoration'
import { useSwipeDrawer } from './hooks/use-swipe-drawer'
import { Header } from './components/layout/header'
import { ArticleList, type ArticleListHandle, ArticleDetail, ArticleRawPage } from '@/features/reading'
import { PageLayout } from './components/layout/page-layout'
import { KeyboardNavigationProvider, useKeyboardNavigationContext } from './contexts/keyboard-navigation-context'
import { CategoryTabs } from '@/features/feeds'
import { isSidebarCollapsed, persistSidebarCollapsed } from './lib/sidebar-collapsed'
const SettingsPage = lazy(() => import('@/features/settings/settings-page').then(m => ({ default: m.SettingsPage })))
const ChatPage = lazy(() => import('@/features/chat/chat-page').then(m => ({ default: m.ChatPage })))
const FrontPage = lazy(() => import('@/features/reading/pages/front-page').then(m => ({ default: m.FrontPage })))
const StoriesPage = lazy(() => import('@/features/reading/pages/stories-page').then(m => ({ default: m.StoriesPage })))
const JournalPage = lazy(() => import('@/features/reading/pages/journal-page').then(m => ({ default: m.JournalPage })))
import { AuthShell } from './lib/auth-shell'
import { ErrorBoundary } from './components/auth/error-boundary'
import { HintBanner } from './components/ui/hint-banner'
import { Toaster } from 'sonner'
import { FetchProgressProvider } from './contexts/fetch-progress-context'
import { useArticleAutoRefresh } from './hooks/use-article-auto-refresh'
import { TooltipProvider } from './components/ui/tooltip'
import type { ClassificationOverview } from '../shared/classification'

export interface AppLayoutContext {
  settings: Settings
  sidebarOpen: boolean
  setSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>
}

function AppLayout() {
  const settings = useSettings()
  const [sidebarOpen, setSidebarOpen] = useState(() => !isSidebarCollapsed() && window.matchMedia(`(min-width: ${MD_BREAKPOINT}px)`).matches)

  // Remember the desktop collapse/open state so it survives reloads
  useEffect(() => {
    if (window.matchMedia(`(min-width: ${MD_BREAKPOINT}px)`).matches) {
      persistSidebarCollapsed(!sidebarOpen)
    }
  }, [sidebarOpen])

  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${MD_BREAKPOINT}px)`)
    const handler = (e: MediaQueryListEvent) => setSidebarOpen(e.matches && !isSidebarCollapsed())
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  useSwipeDrawer(sidebarOpen, setSidebarOpen)
  useArticleAutoRefresh()

  const { data: profile } = useSWR<{ language: string | null }>('/api/settings/profile', fetcher)

  // Query parameter ?lang=fr|en|zh takes highest priority (useful for demo sharing links)
  const langFromUrl = useMemo(() => {
    const p = new URLSearchParams(window.location.search).get('lang')
    return isLocale(p) ? p : null
  }, [])

  // A locale no longer offered (e.g. a stored 'ja') is ignored and falls back to the browser's
  const [locale, setLocaleState] = useState<Locale>(() => {
    if (langFromUrl) return langFromUrl
    const cached = localStorage.getItem('locale')
    return isLocale(cached) ? cached : browserLocale()
  })

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l)
    localStorage.setItem('locale', l)
  }, [])

  useEffect(() => {
    // When ?lang= is present, persist it and skip profile override
    if (langFromUrl) {
      localStorage.setItem('locale', langFromUrl)
      return
    }
    // Only apply profile language as initial fallback — if localStorage already
    // has a valid locale the user explicitly chose, respect it.
    if (isLocale(localStorage.getItem('locale'))) return
    if (isLocale(profile?.language)) {
      setLocale(profile.language)
    }
  }, [profile, setLocale, langFromUrl])

  const localeCtx = useMemo(() => ({ locale, setLocale }), [locale, setLocale])

  useEffect(() => {
    document.title = APP_NAME
  }, [])

  return (
    <LocaleContext.Provider value={localeCtx}>
      <TooltipProvider delayDuration={300}>
        <div className="min-h-screen bg-bg text-text">
          <FetchProgressProvider>
            <KeyboardNavigationProvider>
              <Outlet context={{ settings, sidebarOpen, setSidebarOpen }} />
            </KeyboardNavigationProvider>
          </FetchProgressProvider>
          <Toaster
            theme="system"
            duration={5000}
            position="top-right"
            richColors
            offset={{
              top: 'calc(var(--safe-area-inset-top) + 24px)',
              right: '24px',
              bottom: 'calc(var(--safe-area-inset-bottom) + 24px)',
              left: '24px',
            }}
            mobileOffset={{
              top: 'calc(var(--safe-area-inset-top) + 16px)',
              right: '16px',
              bottom: 'calc(var(--safe-area-inset-bottom) + 16px)',
              left: '16px',
            }}
          />
        </div>
      </TooltipProvider>
    </LocaleContext.Provider>
  )
}

export function useAppLayout() {
  return useOutletContext<AppLayoutContext>()
}

function ArticleListPage() {
  const { feedId, categoryId, folderId, formatId, themeId } = useParams<{ feedId?: string; categoryId?: string; folderId?: string; formatId?: string; themeId?: string }>()
  const location = useLocation()
  const { t } = useI18n()
  const { settings } = useAppLayout()
  const isInbox = location.pathname === '/inbox'
  const isRecommended = location.pathname === '/recommended'
  const { data: smartFoldersData } = useSWR<{ folders: Array<{ id: number; name: string }> }>(folderId ? '/api/smart-folders' : null, fetcher)
  const isBookmarks = location.pathname === '/bookmarks'
  const isLikes = location.pathname === '/likes'
  const isHistory = location.pathname === '/history'
  const isClips = location.pathname === '/clips'
  const { data: feedsData } = useSWR<{ feeds: Array<{ id: number; name: string; type: string; category_id: number | null; category_name: string | null }>; clip_feed_id: number | null }>('/api/feeds', fetcher)
  const { data: categoriesData } = useSWR<{ categories: Array<{ id: number; name: string }> }>('/api/categories', fetcher)
  const { data: classification } = useSWR<ClassificationOverview>(formatId || themeId ? '/api/classification' : null, fetcher)

  const headerName = isHistory
    ? t('feeds.history')
    : isLikes
      ? t('feeds.likes')
      : isBookmarks
        ? t('feeds.bookmarks')
        : isInbox
          ? t('feeds.inbox')
          : isClips
            ? t('feeds.clips')
            : isRecommended
              ? t('recommended.title')
              : folderId
                ? smartFoldersData?.folders.find(f => f.id === Number(folderId))?.name ?? null
            : formatId
              ? classification?.formats.find(f => f.id === formatId)?.label ?? formatId
            : themeId
              ? classification?.themes.find(c => c.id === themeId)?.label ?? themeId
            : feedId
          ? feedsData?.feeds.find(f => f.id === Number(feedId))?.name ?? null
          : categoryId
            ? categoriesData?.categories.find(c => c.id === Number(categoryId))?.name ?? null
            : null

  const articleListRef = useRef<ArticleListHandle>(null)
  const revalidateArticles = useCallback(() => articleListRef.current?.revalidate(), [])

  return (
    <PageLayout
      feedName={headerName}
      feedListProps={{ onMarkAllRead: revalidateArticles, onArticleMoved: revalidateArticles }}
    >
      {settings.simpleMode !== 'on' && <CategoryTabs />}
      {isInbox && <HintBanner storageKey="hint-dismissed-inbox">{t('hint.inbox')}</HintBanner>}
      {isBookmarks && <HintBanner storageKey="hint-dismissed-bookmarks">{t('hint.bookmarks')}</HintBanner>}
      {isLikes && <HintBanner storageKey="hint-dismissed-likes">{t('hint.likes')}</HintBanner>}
      {isHistory && <HintBanner storageKey="hint-dismissed-history">{t('hint.history')}</HintBanner>}
      {isClips && <HintBanner storageKey="hint-dismissed-clips">{t('hint.clips')}</HintBanner>}
      {isRecommended && <HintBanner storageKey="hint-dismissed-recommended">{t('hint.recommended')}</HintBanner>}
      {folderId && <HintBanner storageKey="hint-dismissed-smart">{t('hint.smart')}</HintBanner>}
      <ArticleList ref={articleListRef} />
    </PageLayout>
  )
}

function SettingsPageWrapper() {
  return (
    <PageLayout>
      <Suspense>
        <SettingsPage />
      </Suspense>
    </PageLayout>
  )
}

function ChatPageWrapper() {
  const { t } = useI18n()
  const { conversationId } = useParams<{ conversationId?: string }>()
  const navigate = useNavigate()

  const { data: convData } = useSWR<{ conversations: Array<{ id: string; title: string | null }> }>(
    conversationId ? '/api/chat/conversations' : null,
    fetcher,
    { revalidateOnFocus: false },
  )
  const conversationTitle = convData?.conversations?.find(c => c.id === conversationId)?.title ?? null

  return (
    <PageLayout
      mode={conversationId ? 'detail' : 'list'}
      feedName={conversationId ? undefined : t('chat.title')}
      detailTitle={conversationTitle}
      onBack={() => navigate('/chat')}
    >
      <Suspense>
        <ChatPage />
      </Suspense>
    </PageLayout>
  )
}

function StoriesPageWrapper() {
  const { t } = useI18n()
  return (
    <PageLayout feedName={t('stories.title')}>
      <HintBanner storageKey="hint-dismissed-stories">{t('hint.stories')}</HintBanner>
      <Suspense>
        <StoriesPage />
      </Suspense>
    </PageLayout>
  )
}

function JournalPageWrapper() {
  const { t } = useI18n()
  return (
    <PageLayout feedName={t('journal.title')}>
      <HintBanner storageKey="hint-dismissed-journal">{t('hint.journal')}</HintBanner>
      <Suspense>
        <JournalPage />
      </Suspense>
    </PageLayout>
  )
}

function FrontPageWrapper() {
  const { t } = useI18n()
  const { settings } = useAppLayout()
  // Simple mode opens on the journal instead of the front page
  if (settings.simpleMode === 'on') return <Navigate to="/journal" replace />
  return (
    <PageLayout feedName={t('frontpage.title')}>
      <CategoryTabs />
      <Suspense>
        <FrontPage />
      </Suspense>
    </PageLayout>
  )
}

function ArticleDetailPage() {
  const { '*': splat } = useParams()
  const { lastListUrl } = useKeyboardNavigationContext()
  const navigate = useNavigate()

  if (!splat) return null

  // Reconstruct the article URL, preserving the original protocol.
  // http:// articles are routed as /http/<host>/<path> so this page can
  // reconstruct the exact stored URL without hardcoding https://.
  const rawSplat = splat.endsWith('.md') ? splat.slice(0, -3) : splat
  const articleUrl = rawSplat.startsWith('http/')
    ? `http://${decodeURIComponent(rawSplat.slice(5))}`
    : `https://${decodeURIComponent(rawSplat)}`

  if (splat.endsWith('.md')) {
    return <ArticleRawPage articleUrl={articleUrl} />
  }

  return (
    <>
      <Header mode="detail" onBack={() => navigate(lastListUrl || '/inbox')} />
      <ArticleDetail articleUrl={articleUrl} enableZapNavigation />
    </>
  )
}

// Determine the "page type" for animation decisions
function getPageType(pathname: string): 'detail' | 'list' {
  if (pathname === '/' || pathname === '/inbox' || pathname === '/bookmarks' || pathname === '/likes' || pathname === '/history' || pathname === '/clips' || pathname === '/stories' || pathname === '/journal' || pathname === '/recommended' || pathname.startsWith('/smart/') || pathname.startsWith('/feeds/') || pathname.startsWith('/categories/') || pathname.startsWith('/formats/') || pathname.startsWith('/themes/') || pathname.startsWith('/settings') || pathname.startsWith('/chat')) {
    return 'list'
  }
  return 'detail'
}

/**
 * Renders nothing. Lives inside the motion.div so it mounts/unmounts with it.
 * useLayoutEffect restores scroll synchronously before the browser paints,
 * meaning the fade-in animation already shows the page at the saved position.
 */
function ScrollRestore({ pathname, pageType }: { pathname: string; pageType: string }) {
  useLayoutEffect(() => {
    if (pageType === 'list') {
      restoreScrollPosition(pathname)
    }
  }, [pathname, pageType])
  return null
}

function AnimatedRoutes() {
  const location = useLocation()
  const isTouchDevice = useIsTouchDevice()
  const pageType = getPageType(location.pathname)

  // Track navigation direction to avoid double-animation on swipe-back.
  // Browser's native swipe-back already animates, so we only slide on PUSH.
  const navAction = useRef<'PUSH' | 'POP' | 'REPLACE'>('PUSH')
  useEffect(() => {
    const handler = () => { navAction.current = 'POP' }
    window.addEventListener('popstate', handler)
    return () => window.removeEventListener('popstate', handler)
  }, [])

  // Reset to PUSH after each render so link navigations get the slide
  const currentAction = navAction.current
  useEffect(() => { navAction.current = 'PUSH' })

  // Save scroll position when navigating away from a page
  const prevPathname = useRef(location.pathname)
  useEffect(() => {
    if (prevPathname.current !== location.pathname) {
      saveScrollPosition(prevPathname.current)
      prevPathname.current = location.pathname
    }
  }, [location.pathname])

  // Only slide-in on touch devices navigating forward to a detail page
  const isDetailSlide = isTouchDevice && pageType === 'detail' && currentAction === 'PUSH'
  // On POP (swipe-back), skip the exit slide to avoid doubling with the native animation
  const isExitSlide = isTouchDevice && pageType === 'detail' && currentAction === 'PUSH'
  const isPop = currentAction === 'POP'

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={pageType === 'detail' ? location.pathname : pageType}
        initial={isPop ? false : (isDetailSlide ? { x: '100%', opacity: 1 } : { opacity: 0 })}
        animate={isDetailSlide ? { x: 0, opacity: 1 } : { opacity: 1 }}
        exit={isPop ? { opacity: 1 } : (isExitSlide ? { x: '100%', opacity: 1 } : { opacity: 0 })}
        transition={isPop
          ? { duration: 0 }
          : isDetailSlide
            ? { type: 'tween', duration: 0.25, ease: [0.32, 0.72, 0, 1] }
            : { duration: 0.15 }
        }
        style={{ minHeight: '100vh' }}
      >
        <ScrollRestore pathname={location.pathname} pageType={pageType} />
        <Routes location={location}>
          <Route element={<AppLayout />}>
            <Route path="/" element={<FrontPageWrapper />} />
            <Route path="/inbox" element={<ArticleListPage />} />
            <Route path="/bookmarks" element={<ArticleListPage />} />
            <Route path="/likes" element={<ArticleListPage />} />
            <Route path="/history" element={<ArticleListPage />} />
            <Route path="/clips" element={<ArticleListPage />} />
            <Route path="/recommended" element={<ArticleListPage />} />
            <Route path="/smart/:folderId" element={<ArticleListPage />} />
            <Route path="/stories" element={<StoriesPageWrapper />} />
            <Route path="/journal" element={<JournalPageWrapper />} />
            <Route path="/feeds/:feedId" element={<ArticleListPage />} />
            <Route path="/categories/:categoryId" element={<ArticleListPage />} />
            <Route path="/formats/:formatId" element={<ArticleListPage />} />
            <Route path="/themes/:themeId" element={<ArticleListPage />} />
            <Route path="/settings" element={<Navigate to="/settings/general" replace />} />
            <Route path="/settings/:tab" element={<SettingsPageWrapper />} />
            <Route path="/chat" element={<ChatPageWrapper />} />
            <Route path="/chat/:conversationId" element={<ChatPageWrapper />} />
            <Route path="/*" element={<ArticleDetailPage />} />
          </Route>
        </Routes>
      </motion.div>
    </AnimatePresence>
  )
}

export default function App() {
  return (
    <SWRConfig value={{
      fetcher,
      dedupingInterval: 5000,
      revalidateOnFocus: false,
      revalidateIfStale: false,
      revalidateOnReconnect: false,
      errorRetryCount: 2,
    }}>
      <BrowserRouter>
        <ErrorBoundary>
          <AuthShell>
            <AnimatedRoutes />
          </AuthShell>
        </ErrorBoundary>
      </BrowserRouter>
    </SWRConfig>
  )
}
