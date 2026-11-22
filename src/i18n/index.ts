import { createContext, useContext } from 'react'
import { dict } from './messages/index.js'

export const LOCALES = ['fr', 'en', 'zh'] as const
export type Locale = typeof LOCALES[number]

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
}

/** The browser's language when it is one of ours, English otherwise */
export function browserLocale(): Locale {
  const lang = navigator.language.toLowerCase()
  return LOCALES.find(l => lang.startsWith(l)) ?? 'en'
}

export { APP_NAME } from './app-name.js'

type MessageKey = keyof typeof dict

const errorCodeMap: Record<string, MessageKey> = {
  ANTHROPIC_KEY_NOT_SET: 'error.anthropicKeyNotSet',
  GEMINI_KEY_NOT_SET: 'error.geminiKeyNotSet',
  OPENAI_KEY_NOT_SET: 'error.openaiKeyNotSet',
  GOOGLE_TRANSLATE_KEY_NOT_SET: 'error.googleTranslateKeyNotSet',
  DEEPL_KEY_NOT_SET: 'error.deeplKeyNotSet',
  SUMMARIZATION_FAILED: 'error.summarizationFailed',
  TRANSLATION_FAILED: 'error.translationFailed',
}

interface LocaleContextValue {
  locale: Locale
  setLocale: (locale: Locale) => void
}

const defaultLocale: Locale = browserLocale()

function resolveLocale(): Locale {
  const stored = localStorage.getItem('locale')
  return isLocale(stored) ? stored : defaultLocale
}

/** Translate outside React tree (resolves locale from localStorage) */
export function translate(key: MessageKey): string {
  return dict[key][resolveLocale()]
}

export const LocaleContext = createContext<LocaleContextValue>({
  locale: defaultLocale,
  setLocale: () => {},
})

export type TranslateFn = (key: MessageKey, params?: Record<string, string>) => string

/** Check whether a string is a valid i18n message key. */
export function isMessageKey(key: string): key is MessageKey {
  return key in dict
}

export function useI18n() {
  const { locale, setLocale } = useContext(LocaleContext)
  const t = (key: MessageKey, params?: Record<string, string>): string => {
    let text: string = dict[key][locale]
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        text = text.replaceAll(`\${${k}}`, v)
      }
    }
    return text
  }
  const tError = (message: string): string => {
    const i18nKey = errorCodeMap[message]
    return i18nKey ? t(i18nKey) : message
  }
  const isKeyNotSetError = (message: string): boolean => message in errorCodeMap
  return { t, tError, isKeyNotSetError, locale, setLocale } as const
}
