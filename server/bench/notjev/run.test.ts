import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

/**
 * run.ts must not open the production database through the app's connection
 * module: that module opens its database as soon as it is imported, so any
 * static import reaching it would run before DATABASE_URL points at the
 * snapshot. Only these static imports are allowed; the pipeline (which
 * reads the database) is imported dynamically after the switch.
 */
const ALLOWED = new Set(['node:fs', 'node:path', 'libsql', '../../paths.js', './config.js', './lock.js', './types.js'])

describe('run.ts imports', () => {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const src = fs.readFileSync(path.join(here, 'run.ts'), 'utf8')

  it('imports nothing that opens the database before the snapshot switch', () => {
    const statics = [...src.matchAll(/^import\s[^'"]*['"]([^'"]+)['"]/gm)].map(m => m[1])
    expect(statics.filter(s => !ALLOWED.has(s))).toEqual([])
    for (const local of statics.filter(s => s.startsWith('./'))) {
      const dep = fs.readFileSync(path.join(here, local.replace(/\.js$/, '.ts')), 'utf8')
      expect(dep, `${local} must not import the database`).not.toMatch(/from ['"][^'"]*\/db(\/[^'"]*)?(\.js)?['"]/)
    }
  })

  it('opens the source read-only and imports the pipeline only after DATABASE_URL points at the snapshot', () => {
    expect(src).toContain("new Database(source, { readonly: true })")
    const switchAt = src.indexOf('process.env.DATABASE_URL = `file:${snapshotPath}`')
    const importAt = src.indexOf("await import('./pipeline.js')")
    expect(switchAt).toBeGreaterThan(0)
    expect(importAt).toBeGreaterThan(switchAt)
  })
})
