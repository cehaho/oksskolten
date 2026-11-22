import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProviderConfigSection } from './provider-config-section'
import type { Settings } from '@/hooks/preferences'

// --- Mocks ---

const mockFetcher = vi.fn()
const mockApiPatch = vi.fn()
const mockApiPost = vi.fn()

vi.mock('../../../lib/fetcher', () => ({
  fetcher: (...args: unknown[]) => mockFetcher(...args),
  apiPatch: (...args: unknown[]) => mockApiPatch(...args),
  apiPost: (...args: unknown[]) => mockApiPost(...args),
}))

const globalMutate = vi.fn()

vi.mock('swr', () => ({
  default: (key: string) => {
    if (key === '/api/settings/preferences') {
      return { data: { 'vllm.base_url': 'http://vllm:8000', 'ollama.base_url': 'http://ollama:11434' }, mutate: vi.fn() }
    }
    return { data: { configured: false }, mutate: vi.fn() }
  },
  useSWRConfig: () => ({ mutate: globalMutate }),
}))

// The section takes `t` as a prop, so returning the key makes every card's
// controls addressable by their own i18n key.
const t = ((key: string) => key) as never

const settings = {
  translateTargetLang: '',
  setTranslateTargetLang: vi.fn(),
} as unknown as Settings

// The vLLM and embeddings cards share some labels (test button, URL placeholder)
const vllmCard = () => screen.getByText('provider.vllm').closest('div.p-3') as HTMLElement
const embeddingsSection = () => screen.getByText('embeddings.title').parentElement as HTMLElement

describe('ProviderConfigSection — dynamic model lists', () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 })

  beforeEach(() => {
    vi.clearAllMocks()
    mockApiPatch.mockResolvedValue({})
    mockApiPost.mockResolvedValue({})
  })

  it('refreshes the vLLM model list after a successful connection test', async () => {
    mockFetcher.mockResolvedValue({ ok: true, model_count: 2 })
    render(<ProviderConfigSection t={t} settings={settings} />)

    await user.click(within(vllmCard()).getByRole('button', { name: 'vllm.testConnection' }))

    await waitFor(() => expect(mockFetcher).toHaveBeenCalledWith('/api/settings/vllm/status'))
    expect(globalMutate).toHaveBeenCalledWith('/api/settings/vllm/models')
  })

  it('leaves the cached vLLM model list alone when the test fails', async () => {
    mockFetcher.mockResolvedValue({ ok: false, error: 'ECONNREFUSED' })
    render(<ProviderConfigSection t={t} settings={settings} />)

    await user.click(within(vllmCard()).getByRole('button', { name: 'vllm.testConnection' }))

    await waitFor(() => expect(mockFetcher).toHaveBeenCalledWith('/api/settings/vllm/status'))
    expect(globalMutate).not.toHaveBeenCalledWith('/api/settings/vllm/models')
  })

  it('refreshes the vLLM model list after saving a new server URL', async () => {
    render(<ProviderConfigSection t={t} settings={settings} />)

    const baseUrl = within(vllmCard()).getByPlaceholderText('vllm.baseUrlPlaceholder')
    await user.clear(baseUrl)
    await user.type(baseUrl, 'http://vllm:9000')

    const card = baseUrl.closest('div.p-3') as HTMLElement
    await user.click(within(card).getByRole('button', { name: 'settings.save' }))

    await waitFor(() => expect(mockApiPatch).toHaveBeenCalledWith('/api/settings/preferences', { 'vllm.base_url': 'http://vllm:9000' }))
    expect(globalMutate).toHaveBeenCalledWith('/api/settings/vllm/models')
  })

  it('refreshes the Ollama model list after a successful connection test', async () => {
    mockFetcher.mockResolvedValue({ ok: true, version: '0.5.0', model_count: 3 })
    render(<ProviderConfigSection t={t} settings={settings} />)

    await user.click(screen.getByRole('button', { name: 'ollama.testConnection' }))

    await waitFor(() => expect(mockFetcher).toHaveBeenCalledWith('/api/settings/ollama/status'))
    expect(globalMutate).toHaveBeenCalledWith('/api/settings/ollama/models')
  })
})

describe('ProviderConfigSection — embeddings', () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 })

  beforeEach(() => {
    vi.clearAllMocks()
    mockApiPatch.mockResolvedValue({})
    mockApiPost.mockResolvedValue({})
  })

  it('saves URL, model and dimensions together', async () => {
    render(<ProviderConfigSection t={t} settings={settings} />)
    const section = embeddingsSection()

    await user.type(within(section).getByPlaceholderText('bge-m3'), 'bge-m3')
    await user.click(within(section).getByRole('button', { name: 'settings.save' }))

    await waitFor(() => expect(mockApiPatch).toHaveBeenCalledWith('/api/settings/preferences', {
      'embeddings.base_url': '',
      'embeddings.model': 'bge-m3',
      'embeddings.dimensions': '1024',
    }))
    expect(mockApiPost).not.toHaveBeenCalled()
  })

  it('reports a vector size that differs from the setting', async () => {
    mockFetcher.mockResolvedValue({ ok: true, dimensions: 768, expected: 1024, ms: 12 })
    render(<ProviderConfigSection t={t} settings={settings} />)

    await user.click(within(embeddingsSection()).getByRole('button', { name: 'vllm.testConnection' }))

    await waitFor(() => expect(mockFetcher).toHaveBeenCalledWith('/api/settings/embeddings/status'))
    expect(within(embeddingsSection()).getByText('embeddings.testMismatch')).toBeTruthy()
  })

  it('asks for a model when none is saved', async () => {
    mockFetcher.mockResolvedValue({ ok: false, error: 'EMBEDDINGS_NOT_CONFIGURED' })
    render(<ProviderConfigSection t={t} settings={settings} />)

    await user.click(within(embeddingsSection()).getByRole('button', { name: 'vllm.testConnection' }))

    expect(await within(embeddingsSection()).findByText('embeddings.noModel')).toBeTruthy()
  })
})
