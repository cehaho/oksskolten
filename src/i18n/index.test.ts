import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { createElement } from 'react'
import { LocaleContext, useI18n } from '@/i18n'
import { dict } from './messages/index.js'
import { auth } from './messages/auth.js'
import { chat } from './messages/chat.js'
import { common } from './messages/common.js'
import { feeds } from './messages/feeds.js'
import { intelligence } from './messages/intelligence.js'
import { reading } from './messages/reading.js'
import { settings } from './messages/settings.js'
import { journal } from './messages/journal.js'

function makeWrapper(locale: 'ja' | 'en') {
  return ({ children }: { children: React.ReactNode }) =>
    createElement(LocaleContext.Provider, { value: { locale, setLocale: () => {} } }, children)
}

describe('useI18n', () => {
  it('returns Japanese text when locale is ja', () => {
    const { result } = renderHook(() => useI18n(), { wrapper: makeWrapper('ja') })
    expect(result.current.t('feeds.inbox')).toBe('Inbox')
    expect(result.current.t('feeds.title')).toBe('フィード')
  })

  it('returns English text when locale is en', () => {
    const { result } = renderHook(() => useI18n(), { wrapper: makeWrapper('en') })
    expect(result.current.t('feeds.title')).toBe('Feeds')
  })

  it('replaces parameters in text', () => {
    const { result } = renderHook(() => useI18n(), { wrapper: makeWrapper('en') })
    const text = result.current.t('feeds.deleteConfirm', { name: 'TestFeed' })
    expect(text).toContain('TestFeed')
    expect(text).not.toContain('${name}')
  })

  it('replaces parameters in Japanese text', () => {
    const { result } = renderHook(() => useI18n(), { wrapper: makeWrapper('ja') })
    const text = result.current.t('feeds.deleteConfirm', { name: 'テスト' })
    expect(text).toContain('テスト')
    expect(text).not.toContain('${name}')
  })

  it('exposes locale value', () => {
    const { result } = renderHook(() => useI18n(), { wrapper: makeWrapper('ja') })
    expect(result.current.locale).toBe('ja')
  })
})

describe('message dictionary', () => {
  it('has no duplicate keys across domain files', () => {
    const sum = [common, reading, feeds, intelligence, chat, auth, settings, journal]
      .reduce((n, part) => n + Object.keys(part).length, 0)
    expect(sum).toBe(Object.keys(dict).length)
  })

  it('contains 948 keys', () => {
    expect(Object.keys(dict).length).toBe(948)
  })
})
