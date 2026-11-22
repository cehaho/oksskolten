import fs from 'node:fs'
import path from 'node:path'
import Database from 'libsql'
import { DATA_DIR } from '../../paths.js'
import { FILES, loadConfig, outputDir, resolveArbitrations, resolveLabels, resolveRunDir } from './config.js'
import { acquireLock } from './lock.js'
import type { ProgressFile } from './types.js'

/**
 * Entry point of the notjev accuracy bench (`npm run bench:notjev`, or the
 * button in Settings → Classification, which spawns this file).
 *
 * The production database is only ever opened READ-ONLY, once, to copy it
 * with VACUUM INTO. Every later read goes to the snapshot: DATABASE_URL is
 * pointed at it BEFORE the production modules are imported, because the
 * connection module opens its database when it loads.
 *
 * Only static imports here: node built-ins, libsql, paths, config, lock and
 * types (run.test.ts checks it), so nothing opens the production database
 * through the app's connection module before the switch.
 */

function sourceDbPath(sourceDb: string): string {
  const url = sourceDb || process.env.DATABASE_URL || ''
  if (!url) return path.join(DATA_DIR, 'rss.db')
  if (/^(libsql|https?|wss?):/i.test(url)) {
    throw new Error(`The bench snapshots a local SQLite file; ${url.split('?')[0]} is a remote database`)
  }
  if (url.startsWith('file://')) return decodeURIComponent(new URL(url).pathname)
  return path.resolve(url.replace(/^file:/, '').split('?')[0])
}

function snapshot(source: string, target: string): void {
  if (!fs.existsSync(source)) throw new Error(`Database not found: ${source}`)
  if (path.resolve(source) === path.resolve(target)) throw new Error(`The snapshot would overwrite the source database ${source}`)
  const db = new Database(source, { readonly: true })
  try {
    // A consistent copy, even while the server writes (WAL)
    db.prepare('VACUUM INTO ?').run(target)
  } finally {
    db.close()
  }
}

function writeProgress(dir: string, patch: Partial<ProgressFile>): ProgressFile {
  const file = path.join(dir, FILES.progress)
  const prev = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) as ProgressFile : null
  const next = { ...prev, ...patch, updatedAt: new Date().toISOString(), pid: process.pid } as ProgressFile
  fs.writeFileSync(file + '.tmp', JSON.stringify(next, null, 1))
  fs.renameSync(file + '.tmp', file)
  return next
}

// Resolved once: a new run folder name carries the current time
const cfg = loadConfig()
const runDir = resolveRunDir(cfg)
// Progress is only written once the lock is held: a refused second start
// must not mark the run that holds the lock as failed or stopped
let locked = false

async function main(): Promise<void> {
  const arbitrationsFile = resolveArbitrations(cfg)
  const labelsFile = resolveLabels(cfg)
  const snapshotPath = path.join(runDir, FILES.snapshot)
  // Arbitrations or labels recompute an existing run's report: no call is made
  const reportOnly = !!arbitrationsFile || !!labelsFile

  if (reportOnly && !fs.existsSync(snapshotPath)) {
    throw new Error(`${arbitrationsFile ? 'arbitrationsFile' : 'labelsFile'} is set but ${runDir} holds no run: set runDir to the run it belongs to`)
  }
  // Before anything else: a second run (button or command line) stops here
  const release = acquireLock(outputDir(cfg), runDir)
  locked = true
  process.on('exit', release)
  fs.mkdirSync(runDir, { recursive: true })

  writeProgress(runDir, {
    status: 'running',
    phase: 'snapshot',
    message: '',
    trial: cfg.trial,
    errors: 0,
    finishedAt: null,
    ...(reportOnly ? {} : { startedAt: new Date().toISOString() }),
  })

  if (!fs.existsSync(snapshotPath)) {
    const source = sourceDbPath(cfg.sourceDb)
    console.log(`Snapshot ${source} -> ${snapshotPath}`)
    snapshot(source, snapshotPath)
  } else {
    console.log(`Resuming ${runDir}`)
  }

  // From here on, the production modules read the snapshot only
  process.env.DATABASE_URL = `file:${snapshotPath}`
  const { runPipeline } = await import('./pipeline.js')
  await runPipeline({ cfg, runDir, arbitrationsFile, labelsFile, reportOnly, progress: p => writeProgress(runDir, p) })
}

function stop(signal: string): void {
  if (locked && fs.existsSync(runDir)) {
    // Progress is written at most once a second: count what is really recorded
    const results = path.join(runDir, FILES.results)
    const callsDone = fs.existsSync(results) ? fs.readFileSync(results, 'utf8').split('\n').filter(l => l.trim()).length : 0
    writeProgress(runDir, { status: 'stopped', message: `stopped (${signal})`, callsDone, finishedAt: new Date().toISOString() })
  }
  process.exit(130)
}
process.on('SIGTERM', () => stop('SIGTERM'))
process.on('SIGINT', () => stop('SIGINT'))

main().catch(err => {
  const message = err instanceof Error ? err.message : String(err)
  console.error(err)
  if (locked && fs.existsSync(runDir)) {
    writeProgress(runDir, { status: 'error', message, finishedAt: new Date().toISOString() })
  }
  process.exit(1)
})
