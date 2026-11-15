import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { FeedManagementSection } from './feed-management-section'
import type { FeedWithCounts } from '../../../../shared/types'

// --- Mocks ---

const mockApiPost = vi.fn()
const mockApiPatch = vi.fn()
const mockApiDelete = vi.fn()

vi.mock('../../../lib/fetcher', () => ({
  fetcher: vi.fn(),
  apiPost: (...args: unknown[]) => mockApiPost(...args),
  apiPatch: (...args: unknown[]) => mockApiPatch(...args),
  apiDelete: (...args: unknown[]) => mockApiDelete(...args),
}))

const mockStartFeedFetch = vi.fn().mockResolvedValue({ totalNew: 0 })

vi.mock('../../../contexts/fetch-progress-context', () => ({
  useFetchProgressContext: () => ({ startFeedFetch: mockStartFeedFetch }),
}))

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))

// The modal has its own test; here only the wiring matters.
vi.mock('@/features/feeds', () => ({
  FeedModal: ({ initialStep }: { initialStep?: string }) => <div data-testid="feed-modal">{initialStep}</div>,
}))

const mutateFeeds = vi.fn()

function createFeed(overrides: Partial<FeedWithCounts> & { id: number; name: string }): FeedWithCounts {
  return {
    url: `https://${overrides.name.toLowerCase().replace(/\s+/g, '-')}.example.com`,
    rss_url: null,
    rss_bridge_url: null,
    category_id: null,
    category_name: null,
    last_error: null,
    error_count: 0,
    disabled: 0,
    requires_js_challenge: 0,
    type: 'rss',
    etag: null,
    last_modified: null,
    last_content_hash: null,
    next_check_at: null,
    check_interval: null,
    created_at: '2026-01-01T00:00:00Z',
    article_count: 0,
    unread_count: 0,
    articles_per_week: 0,
    latest_published_at: new Date().toISOString(),
    ...overrides,
  }
}

const feeds: FeedWithCounts[] = [
  createFeed({ id: 1, name: 'Alpha Blog', category_id: 1, category_name: 'Tech', article_count: 10, unread_count: 2, articles_per_week: 1.5 }),
  createFeed({ id: 2, name: 'Beta News', article_count: 5, unread_count: 7, articles_per_week: 0.5 }),
  createFeed({ id: 3, name: 'Gamma Dead', article_count: 3, disabled: 1, last_error: 'HTTP 404' }),
  createFeed({ id: 4, name: 'Clips', type: 'clip' }),
]

vi.mock('swr', () => ({
  // use-feed-bulk-actions imports the global mutate
  mutate: vi.fn(),
  default: (key: string) => {
    if (key === '/api/categories') {
      return { data: { categories: [{ id: 1, name: 'Tech', sort_order: 0, collapsed: 0, created_at: '' }] }, mutate: vi.fn(), isLoading: false }
    }
    return {
      data: { feeds, bookmark_count: 0, like_count: 0, clip_feed_id: 4 },
      mutate: mutateFeeds,
      isLoading: false,
    }
  },
  useSWRConfig: () => ({ mutate: vi.fn() }),
}))

function renderSection() {
  return render(
    <MemoryRouter>
      <FeedManagementSection />
    </MemoryRouter>,
  )
}

function feedNames(): string[] {
  const rows = screen.getAllByRole('row').slice(1) // skip header row
  return rows.map(row => within(row).getAllByRole('cell')[1].textContent ?? '')
}

describe('FeedManagementSection', () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 })

  beforeEach(() => {
    vi.clearAllMocks()
    mockStartFeedFetch.mockResolvedValue({ totalNew: 0 })
  })

  it('lists every RSS feed and excludes the clip feed', () => {
    renderSection()
    expect(screen.getByText('Alpha Blog')).toBeTruthy()
    expect(screen.getByText('Beta News')).toBeTruthy()
    expect(screen.getByText('Gamma Dead')).toBeTruthy()
    expect(screen.queryByText('Clips')).toBeNull()
  })

  it('shows counts, category and status per feed', () => {
    renderSection()
    const row = screen.getByText('Alpha Blog').closest('tr')!
    expect(within(row).getByText('Tech')).toBeTruthy()
    expect(within(row).getByText('10')).toBeTruthy()
    expect(within(row).getByText('1.5')).toBeTruthy()

    const disabledRow = screen.getByText('Gamma Dead').closest('tr')!
    expect(within(disabledRow).getByText('Disabled')).toBeTruthy()
  })

  it('filters feeds by name or URL', async () => {
    renderSection()
    await user.type(screen.getByLabelText('Search by name or URL'), 'beta')
    expect(feedNames().join()).toContain('Beta News')
    expect(screen.queryByText('Alpha Blog')).toBeNull()
    expect(screen.queryByText('Gamma Dead')).toBeNull()
  })

  it('sorts by unread count, most unread first', async () => {
    renderSection()
    expect(feedNames()[0]).toContain('Alpha Blog')
    await user.click(screen.getByRole('button', { name: /Unread/ }))
    expect(feedNames()[0]).toContain('Beta News')
  })

  it('marks the selected feeds as read', async () => {
    renderSection()
    await user.click(screen.getByLabelText('Alpha Blog'))
    expect(screen.getByText('1 feeds selected')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Mark all as read' }))
    expect(mockApiPost).toHaveBeenCalledWith('/api/feeds/1/mark-all-seen')
    expect(mockApiPost).toHaveBeenCalledTimes(1)
  })

  // Fetching lives on the list side (refresh button, pull-to-refresh, sidebar),
  // where the articles it brings in are on screen; from here the list is not.
  it('offers no fetch action', async () => {
    renderSection()
    expect(screen.queryByRole('button', { name: 'Fetch all feeds' })).toBeNull()

    await user.click(screen.getByLabelText('Beta News'))
    expect(screen.queryByRole('button', { name: 'Fetch articles' })).toBeNull()
  })

  it('edits a feed name and its URLs', async () => {
    mockApiPatch.mockResolvedValue({})
    renderSection()

    await user.click(screen.getByRole('button', { name: /Edit feed — Beta News/ }))
    const dialog = await screen.findByRole('dialog')

    const rssInput = within(dialog).getByLabelText('Feed URL (RSS/Atom)')
    await user.clear(rssInput)
    await user.type(rssInput, 'https://beta.example.com/atom.xml')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    expect(mockApiPatch).toHaveBeenCalledWith('/api/feeds/2', {
      name: 'Beta News',
      url: 'https://beta-news.example.com',
      rss_url: 'https://beta.example.com/atom.xml',
    })
    // A fixed address is worth trying at once
    expect(mockStartFeedFetch).toHaveBeenCalledWith(2)
  })

  it('does not fetch when only the name changed', async () => {
    mockApiPatch.mockResolvedValue({})
    renderSection()

    await user.click(screen.getByRole('button', { name: /Edit feed — Beta News/ }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Name'), ' Daily')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    expect(mockApiPatch).toHaveBeenCalledWith('/api/feeds/2', {
      name: 'Beta News Daily',
      url: 'https://beta-news.example.com',
      rss_url: null,
    })
    expect(mockStartFeedFetch).not.toHaveBeenCalled()
  })

  it('does not fetch a disabled feed after an URL change', async () => {
    mockApiPatch.mockResolvedValue({})
    renderSection()

    await user.click(screen.getByRole('button', { name: /Edit feed — Gamma Dead/ }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Feed URL (RSS/Atom)'), 'https://gamma.example.com/rss')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    expect(mockApiPatch).toHaveBeenCalledWith('/api/feeds/3', {
      name: 'Gamma Dead',
      url: 'https://gamma-dead.example.com',
      rss_url: 'https://gamma.example.com/rss',
    })
    expect(mockStartFeedFetch).not.toHaveBeenCalled()
  })

  it('does not save a feed URL that is not http(s)', async () => {
    renderSection()

    await user.click(screen.getByRole('button', { name: /Edit feed — Beta News/ }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Feed URL (RSS/Atom)'), 'ftp://beta.example.com/feed')

    expect(within(dialog).getByRole('button', { name: 'Save changes' }).hasAttribute('disabled')).toBe(true)
    expect(mockApiPatch).not.toHaveBeenCalled()
  })

  it('offers re-enable only when a disabled feed is selected', async () => {
    renderSection()
    await user.click(screen.getByLabelText('Alpha Blog'))
    expect(screen.queryByRole('button', { name: 'Enable' })).toBeNull()

    await user.click(screen.getByLabelText('Gamma Dead'))
    await user.click(screen.getByRole('button', { name: 'Enable' }))
    expect(mockApiPatch).toHaveBeenCalledWith('/api/feeds/3', { disabled: 0 })
    expect(mockApiPatch).toHaveBeenCalledTimes(1)
  })

  it('deletes the selected feeds after confirmation', async () => {
    renderSection()
    await user.click(screen.getByLabelText('Alpha Blog'))
    await user.click(screen.getByRole('button', { name: 'Delete 1 feeds' }))

    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(/Delete 1 feeds\?/)).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
    expect(mockApiDelete).toHaveBeenCalledWith('/api/feeds/1')
  })

  it('never acts on selected feeds hidden by the current filter', async () => {
    renderSection()
    await user.click(screen.getByLabelText('Alpha Blog'))
    await user.click(screen.getByLabelText('Beta News'))
    expect(screen.getByText('2 feeds selected')).toBeTruthy()

    await user.type(screen.getByLabelText('Search by name or URL'), 'beta')
    expect(screen.getByText('1 feeds selected')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Mark all as read' }))
    expect(mockApiPost).toHaveBeenCalledWith('/api/feeds/2/mark-all-seen')
    expect(mockApiPost).toHaveBeenCalledTimes(1)
  })

  it('extends the selection with Shift + Click', async () => {
    renderSection()
    await user.click(screen.getByLabelText('Alpha Blog'))
    await user.keyboard('{Shift>}')
    await user.click(screen.getByLabelText('Gamma Dead'))
    await user.keyboard('{/Shift}')
    expect(screen.getByText('3 feeds selected')).toBeTruthy()
  })

  it('opens the add-feed modal straight on the feed step', async () => {
    renderSection()
    expect(screen.queryByTestId('feed-modal')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Add Feed' }))

    const modal = screen.getByTestId('feed-modal')
    expect(modal.textContent).toBe('feed')
  })

  it('selects every visible feed from the header checkbox', async () => {
    renderSection()
    await user.click(screen.getByLabelText('Select All'))
    expect(screen.getByText('3 feeds selected')).toBeTruthy()
  })
})
