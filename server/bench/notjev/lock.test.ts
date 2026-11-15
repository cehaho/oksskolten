import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { acquireLock, lockPath, readLock } from './lock.js'

let dir: string
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notjev-lock-')) })
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

describe('bench lock', () => {
  it('refuses a second run while the first holds the lock, and frees it on release', () => {
    const release = acquireLock(dir, '/runs/notjev-bench-a')
    expect(readLock(dir)).toMatchObject({ pid: process.pid, runDir: '/runs/notjev-bench-a' })
    expect(() => acquireLock(dir, '/runs/notjev-bench-b')).toThrow(/Another bench run is in progress.*notjev-bench-a/)
    release()
    expect(fs.existsSync(lockPath(dir))).toBe(false)
    acquireLock(dir, '/runs/notjev-bench-b')()
  })

  it('takes over a lock left by a dead process', () => {
    // Above the highest pid Linux hands out (4194304)
    fs.writeFileSync(lockPath(dir), JSON.stringify({ pid: 4_999_999, runDir: '/runs/old', startedAt: '' }))
    expect(readLock(dir)).toBeNull()
    const release = acquireLock(dir, '/runs/new')
    expect(readLock(dir)?.runDir).toBe('/runs/new')
    release()
  })

  it('never removes a lock that another process took', () => {
    const release = acquireLock(dir, '/runs/a')
    fs.writeFileSync(lockPath(dir), JSON.stringify({ pid: 1, runDir: '/runs/other', startedAt: '' }))
    release()
    expect(fs.existsSync(lockPath(dir))).toBe(true)
  })
})
