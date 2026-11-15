import { describe, it, expect } from 'vitest'
import { extractLetter, hashSeed, permute, rng, shuffle, median } from './util.js'

const L = ['A', 'B', 'C', 'D']

describe('extractLetter', () => {
  it('reads the last "Answer: X" line', () => {
    expect(extractLetter('Maybe A at first.\nAnswer: A\n…on reflection\nAnswer: C', L)).toBe('C')
    // Full-width colon, as some models write it
    expect(extractLetter('Answer\uFF1A B', L)).toBe('B')
  })

  it('ignores letters inside the thinking block', () => {
    expect(extractLetter('<think>Answer: B is tempting</think>\nAnswer: D', L)).toBe('D')
    // Template that strips the opening tag
    expect(extractLetter('Answer: B maybe\n</think>\nAnswer: A', L)).toBe('A')
  })

  it('accepts markdown and parentheses around the letter', () => {
    expect(extractLetter('**Answer: (B)**', L)).toBe('B')
    expect(extractLetter('answer: c', L)).toBe('C')
  })

  it('accepts a reply that is only one letter', () => {
    expect(extractLetter('  B.  ', L)).toBe('B')
  })

  it('does not guess', () => {
    expect(extractLetter('It is clearly the news option.', L)).toBeNull()
    expect(extractLetter('Answer: Bob', L)).toBeNull()
    // A letter outside the menu
    expect(extractLetter('Answer: F', L)).toBeNull()
    expect(extractLetter('<think>still thinking, Answer: A', L)).toBeNull()
  })
})

describe('permute', () => {
  it('never returns the identity for two items or more', () => {
    for (let seed = 0; seed < 200; seed++) {
      const out = permute(['x', 'y'], seed)
      expect(out).toEqual(['y', 'x'])
      const big = permute(L, seed)
      expect(big).not.toEqual(L)
      expect(big.slice().sort()).toEqual(L)
    }
  })

  it('is stable for a given seed', () => {
    const seed = hashSeed(20261103, 42, 'theme')
    expect(permute(L, seed)).toEqual(permute(L, seed))
  })
})

describe('rng / shuffle', () => {
  it('replays the same draw from the same seed', () => {
    const items = Array.from({ length: 50 }, (_, i) => i)
    expect(shuffle(items, rng(7))).toEqual(shuffle(items, rng(7)))
    expect(shuffle(items, rng(7))).not.toEqual(shuffle(items, rng(8)))
  })
})

describe('median', () => {
  it('handles odd, even and empty lists', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 2, 3])).toBe(2.5)
    expect(median([])).toBe(0)
  })
})
