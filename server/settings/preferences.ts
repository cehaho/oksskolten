import { getSetting } from '../db.js'
import { getAllModelValues, getModelValues } from '../../shared/models.js'
import { RELEASE_TYPE_VALUES } from '../feeds/index.js'

export const PREF_KEYS = [
  // appearance
  'appearance.color_theme',
  // reading
  'reading.date_mode',
  'reading.auto_mark_read',
  'reading.auto_translate',
  'reading.auto_translate_concurrency',
  'reading.auto_translate_scope',
  'reading.auto_summarize',
  'reading.unread_indicator',
  'reading.internal_links',
  'reading.show_thumbnails',
  'reading.show_feed_activity',
  'reading.simple_mode',
  'reading.chat_position',
  'reading.article_open_mode',
  'reading.category_unread_only',
  'reading.keyboard_navigation',
  'reading.keybindings',
  // appearance
  'appearance.mascot',
  'appearance.highlight_theme',
  'appearance.font_family',
  'appearance.list_layout',
  // AI tasks (chat / summary / translate)
  'chat.provider',
  'chat.model',
  'summary.provider',
  'summary.model',
  'summary.max_tokens',
  'translate.provider',
  'translate.model',
  'translate.max_tokens',
  'translate.target_lang',
  // providers (ollama / vllm)
  'ollama.base_url',
  'ollama.custom_headers',
  'vllm.base_url',
  // embeddings (OpenAI-compatible server; URL and key fall back to vllm's)
  'embeddings.base_url',
  'embeddings.model',
  'embeddings.dimensions',
  // appearance
  'custom_themes',
  // retention
  'retention.enabled',
  'retention.read_days',
  'retention.unread_days',
  // github
  'github.release_types',
  // videos
  'videos.enabled',
  'videos.max_size_mb',
  'videos.max_height',
] as const
export type PrefKey = typeof PREF_KEYS[number]

export const PREF_ALLOWED: Record<PrefKey, string[] | null> = {
  // appearance
  'appearance.color_theme': null,
  // reading
  'reading.date_mode': ['relative', 'absolute'],
  'reading.auto_mark_read': ['on', 'off'],
  'reading.auto_translate': ['on', 'off'],
  'reading.auto_translate_concurrency': null,
  'reading.auto_translate_scope': ['full', 'titles'],
  'reading.auto_summarize': ['on', 'off'],
  'reading.unread_indicator': ['on', 'off'],
  'reading.internal_links': ['on', 'off'],
  'reading.show_thumbnails': ['on', 'off'],
  'reading.show_feed_activity': ['on', 'off'],
  'reading.simple_mode': ['on', 'off'],
  'reading.chat_position': ['fab', 'inline'],
  'reading.article_open_mode': ['page', 'overlay'],
  'reading.category_unread_only': ['on', 'off'],
  'reading.keyboard_navigation': ['on', 'off'],
  'reading.keybindings': null,
  // appearance
  'appearance.mascot': ['off', 'dream-puff', 'sleepy-giant'],
  'appearance.highlight_theme': null,
  'appearance.font_family': null,
  'appearance.list_layout': ['list', 'card', 'magazine', 'compact'],
  // AI tasks (chat / summary / translate)
  'chat.provider': ['anthropic', 'gemini', 'openai', 'claude-code', 'ollama', 'vllm'],
  'chat.model': getAllModelValues(),
  'summary.provider': ['anthropic', 'gemini', 'openai', 'claude-code', 'ollama', 'vllm'],
  'summary.model': getAllModelValues(),
  'summary.max_tokens': null,
  'translate.provider': ['anthropic', 'gemini', 'openai', 'claude-code', 'ollama', 'vllm', 'google-translate', 'deepl'],
  'translate.model': getAllModelValues(),
  'translate.max_tokens': null,
  'translate.target_lang': ['ja', 'en', 'zh', 'fr'],
  // providers (ollama / vllm)
  'ollama.base_url': null,
  'ollama.custom_headers': null,
  'vllm.base_url': null,
  'embeddings.base_url': null,
  'embeddings.model': null,
  'embeddings.dimensions': null,
  // appearance
  'custom_themes': null,
  // retention
  'retention.enabled': ['on', 'off'],
  'retention.read_days': null,
  'retention.unread_days': null,
  // github
  'github.release_types': RELEASE_TYPE_VALUES,
  // videos
  'videos.enabled': ['on', 'off'],
  'videos.max_size_mb': null,
  'videos.max_height': null,
}

export const PROVIDER_MODEL_PAIRS: Array<{ providerKey: PrefKey; modelKey: PrefKey }> = [
  { providerKey: 'chat.provider', modelKey: 'chat.model' },
  { providerKey: 'summary.provider', modelKey: 'summary.model' },
  { providerKey: 'translate.provider', modelKey: 'translate.model' },
]

export function validateProviderModel(body: Record<string, unknown>): string | null {
  for (const { providerKey, modelKey } of PROVIDER_MODEL_PAIRS) {
    const model = body[modelKey] !== undefined ? String(body[modelKey]) : getSetting(modelKey)
    const provider = body[providerKey] !== undefined ? String(body[providerKey]) : getSetting(providerKey)
    if (!model || !provider) continue
    // google-translate, deepl, ollama, and vllm have no static model list
    if (provider === 'google-translate' || provider === 'deepl' || provider === 'ollama' || provider === 'vllm') continue
    // claude-code uses anthropic model IDs
    const effectiveProvider = provider === 'claude-code' ? 'anthropic' : provider
    const allowedModels = getModelValues(effectiveProvider)
    if (allowedModels.length > 0 && !allowedModels.includes(model)) {
      return `Model ${model} is not valid for provider ${provider}`
    }
  }
  return null
}
