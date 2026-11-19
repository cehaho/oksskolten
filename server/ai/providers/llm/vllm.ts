import OpenAI from 'openai'
import { getSetting } from '../../../db.js'
import type { LLMProvider, LLMMessageParams, LLMStreamResult } from './provider.js'

let cachedBaseUrl = ''
let cachedApiKey = ''
let cachedClient: OpenAI | null = null

/**
 * The server root, without a trailing slash or `/v1`. Every caller (this
 * client, the settings routes, notjev) appends the OpenAI path itself, while
 * OpenAI-compatible servers are usually given as `http://host:port/v1`: kept
 * as entered, that address would become `/v1/v1`.
 */
export function getVllmBaseUrl(): string {
  return normalizeOpenAiBaseUrl(getSetting('vllm.base_url') || process.env.VLLM_BASE_URL || 'http://localhost:8000')
}

/** Strip surrounding blanks, trailing slashes and a trailing `/v1` from an OpenAI-compatible server URL */
export function normalizeOpenAiBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '').replace(/\/v1$/i, '')
}

export function getVllmApiKey(): string {
  return getSetting('api_key.vllm') || ''
}

export function getVllmClient(): OpenAI {
  const baseUrl = getVllmBaseUrl()
  const apiKey = getVllmApiKey()
  if (cachedClient && baseUrl === cachedBaseUrl && apiKey === cachedApiKey) return cachedClient
  cachedBaseUrl = baseUrl
  cachedApiKey = apiKey
  cachedClient = new OpenAI({
    baseURL: baseUrl + '/v1',
    apiKey: apiKey || 'vllm', // Required by SDK even if not used by vLLM
  })
  return cachedClient
}

export const vllmProvider: LLMProvider = {
  name: 'vllm',

  requireKey() {
    // API key is optional for vLLM
  },

  async createMessage(params: LLMMessageParams): Promise<LLMStreamResult> {
    const client = getVllmClient()
    const messages: OpenAI.ChatCompletionMessageParam[] = []
    if (params.systemInstruction) {
      messages.push({ role: 'system', content: params.systemInstruction })
    }
    for (const m of params.messages) {
      messages.push({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      })
    }

    const response = await client.chat.completions.create({
      model: params.model,
      max_completion_tokens: params.maxTokens,
      messages,
      // vLLM extension: disable reasoning-model "thinking" (e.g. Qwen3) so the
      // answer lands in content; chat templates without this variable ignore it
      chat_template_kwargs: { enable_thinking: false },
    } as OpenAI.ChatCompletionCreateParamsNonStreaming)

    const text = response.choices[0]?.message?.content ?? ''
    return {
      text,
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
    }
  },

  async streamMessage(params: LLMMessageParams, onText: (delta: string) => void): Promise<LLMStreamResult> {
    const client = getVllmClient()
    const messages: OpenAI.ChatCompletionMessageParam[] = []
    if (params.systemInstruction) {
      messages.push({ role: 'system', content: params.systemInstruction })
    }
    for (const m of params.messages) {
      messages.push({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      })
    }

    const stream = await client.chat.completions.create({
      model: params.model,
      max_completion_tokens: params.maxTokens,
      messages,
      stream: true,
      stream_options: { include_usage: true },
      // vLLM extension: disable reasoning-model "thinking" (e.g. Qwen3) so the
      // answer lands in content; chat templates without this variable ignore it
      chat_template_kwargs: { enable_thinking: false },
    } as OpenAI.ChatCompletionCreateParamsStreaming)

    let fullText = ''
    let inputTokens = 0
    let outputTokens = 0

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? ''
      if (delta) {
        fullText += delta
        onText(delta)
      }
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens ?? inputTokens
        outputTokens = chunk.usage.completion_tokens ?? outputTokens
      }
    }

    return { text: fullText, inputTokens, outputTokens }
  },
}
