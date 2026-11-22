import fs from 'node:fs'
import path from 'node:path'

/**
 * One bench run at a time, whoever starts it (the settings button or
 * `npm run bench:notjev`): run.ts creates this file atomically before doing
 * anything and removes it on exit. A file left by a dead process (crash,
 * kill -9, server restart) is stale and taken over.
 */

export const LOCK_FILE = 'notjev-bench.lock'

export interface LockInfo {
  pid: number
  runDir: string
  startedAt: string
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // EPERM: the process exists but belongs to another user
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export function lockPath(dir: string): string {
  return path.join(dir, LOCK_FILE)
}

/** The run holding the lock, or null when it is free (a stale lock reads as free) */
export function readLock(dir: string): LockInfo | null {
  let info: LockInfo
  try {
    info = JSON.parse(fs.readFileSync(lockPath(dir), 'utf8')) as LockInfo
  } catch {
    return null
  }
  return Number.isInteger(info.pid) && alive(info.pid) ? info : null
}

/**
 * Take the lock for `runDir`, or throw naming the run that holds it.
 * Returns the release function.
 */
export function acquireLock(dir: string, runDir: string, pid = process.pid): () => void {
  fs.mkdirSync(dir, { recursive: true })
  const file = lockPath(dir)
  const info: LockInfo = { pid, runDir, startedAt: new Date().toISOString() }
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // 'wx' fails when the file exists: two runs starting together cannot both get it
      fs.writeFileSync(file, JSON.stringify(info), { flag: 'wx' })
      let released = false
      return () => {
        if (released) return
        released = true
        try {
          const current = JSON.parse(fs.readFileSync(file, 'utf8')) as LockInfo
          if (current.pid === pid) fs.unlinkSync(file)
        } catch {
          // Already gone
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
      const holder = readLock(dir)
      if (holder) throw new Error(`Another bench run is in progress (pid ${holder.pid}, ${path.basename(holder.runDir)})`)
      // Stale: left by a process that no longer exists
      fs.rmSync(file, { force: true })
    }
  }
  throw new Error(`Could not take the bench lock ${file}`)
}
