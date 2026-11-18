import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { createElement } from 'react'
import { LocaleContext, useI18n, isLocale, type Locale } from '@/i18n'
import { dict } from './messages/index.js'
import { auth } from './messages/auth.js'
import { chat } from './messages/chat.js'
import { common } from './messages/common.js'
import { feeds } from './messages/feeds.js'
import { intelligence } from './messages/intelligence.js'
import { reading } from './messages/reading.js'
import { settings } from './messages/settings.js'
import { journal } from './messages/journal.js'

function makeWrapper(locale: Locale) {
  return ({ children }: { children: React.ReactNode }) =>
    createElement(LocaleContext.Provider, { value: { locale, setLocale: () => {} } }, children)
}

describe('useI18n', () => {
  it('returns French text when locale is fr', () => {
    const { result } = renderHook(() => useI18n(), { wrapper: makeWrapper('fr') })
    expect(result.current.t('feeds.inbox')).toBe('Boîte de réception')
    expect(result.current.t('feeds.title')).toBe('Flux')
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

  it('replaces parameters in French text', () => {
    const { result } = renderHook(() => useI18n(), { wrapper: makeWrapper('fr') })
    const text = result.current.t('feeds.deleteConfirm', { name: 'Flux de test' })
    expect(text).toContain('Flux de test')
    expect(text).not.toContain('${name}')
  })

  it('exposes locale value', () => {
    const { result } = renderHook(() => useI18n(), { wrapper: makeWrapper('fr') })
    expect(result.current.locale).toBe('fr')
  })
})

describe('isLocale', () => {
  it('accepts the offered locales only', () => {
    expect(['fr', 'en', 'zh'].every(isLocale)).toBe(true)
    // Japanese was dropped: a stored 'ja' must fall back instead of being used
    expect(isLocale('ja')).toBe(false)
    expect(isLocale(null)).toBe(false)
  })
})

describe('message dictionary', () => {
  it('has no duplicate keys across domain files', () => {
    const sum = [common, reading, feeds, intelligence, chat, auth, settings, journal]
      .reduce((n, part) => n + Object.keys(part).length, 0)
    expect(sum).toBe(Object.keys(dict).length)
  })

  it('contains 951 keys', () => {
    expect(Object.keys(dict).length).toBe(951)
  })

  it('has a non-empty French, English and Chinese text for every key', () => {
    const missing = Object.entries(dict)
      .filter(([, v]) => ![v.fr, v.en, v.zh].every(s => typeof s === 'string' && s.length > 0))
      .map(([k]) => k)
    expect(missing).toEqual([])
  })
})
