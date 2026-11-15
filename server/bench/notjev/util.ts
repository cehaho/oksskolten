/** Small pure helpers of the notjev accuracy bench (tested in util.test.ts) */

/** 32-bit string hash (FNV-1a), to derive a stable seed per article and question */
export function hashSeed(...parts: Array<string | number>): number {
  let h = 0x811c9dc5
  for (const ch of parts.join('|')) {
    h ^= ch.charCodeAt(0)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** mulberry32: small, fast, seedable PRNG returning floats in [0, 1) */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Fisher-Yates shuffle into a new array */
export function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const out = items.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * A permutation that differs from the identity whenever the list has more
 * than one item: an unchanged order would measure nothing.
 */
export function permute<T>(items: readonly T[], seed: number): T[] {
  if (items.length < 2) return items.slice()
  const random = rng(seed)
  for (let attempt = 0; attempt < 16; attempt++) {
    const out = shuffle(items, random)
    if (out.some((x, i) => x !== items[i])) return out
  }
  return [...items.slice(1), items[0]]
}

/**
 * The final letter of a reasoned answer, or null when it cannot be read
 * without guessing. Accepted: the last "Answer: X" line outside the thinking
 * block, or a reply that is nothing but one valid letter.
 */
export function extractLetter(content: string, letters: readonly string[]): string | null {
  // Drop the thinking block, closed or left open by a template that strips "<think>"
  const visible = content
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/^[\s\S]*<\/think>/, '')
    // A thinking block never closed (cut by max_tokens) holds no final answer
    .replace(/<think>[\s\S]*$/, '')
  // \uFF1A is the full-width colon, escaped so this file stays covered by scripts/lint-no-japanese.ts
  const re = /answer\s*[:\uFF1A]\s*\**\s*\(?\s*([A-Z])\s*\)?(?![A-Za-z])/gi
  let last: string | null = null
  for (let m = re.exec(visible); m; m = re.exec(visible)) last = m[1].toUpperCase()
  if (last) return letters.includes(last) ? last : null
  const bare = visible.trim().replace(/^\**|\**\.?$/g, '')
  return /^[A-Z]$/.test(bare) && letters.includes(bare) ? bare : null
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
}

export function median(xs: number[]): number {
  if (!xs.length) return 0
  const s = xs.slice().sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
