import fs from 'node:fs'
import path from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { requireJson } from '../../auth/index.js'
import { parseOrBadRequest } from '../../lib/validation.js'
import { logger } from '../../logger.js'
import { FILES, PROJECT_ROOT, RUN_ID_RE, loadConfig, newRunId, outputDir } from './config.js'
import { readLock } from './lock.js'
import type { ProgressFile, SampleFile } from './types.js'

/**
 * Settings → Classification → accuracy bench: start, resume or stop a run and
 * read its report without a terminal. The bench runs in a child process (it
 * points its own database connection at a snapshot, which the server cannot
 * do in-process); one run at a time, enforced twice: the child handle below
 * for runs this server started, and the lock file run.ts takes, which also
 * covers a run started with `npm run bench:notjev`.
 *
 * Registered inside the authenticated API scope (routes/index.ts adds
 * requireAuth to every route of settingsRoutes).
 */

const log = logger.child('notjev-bench')

let child: ChildProcess | null = null
let childRun: string | null = null

export interface BenchRunSummary {
  id: string
  running: boolean
  trial: boolean
  articles: number
  progress: ProgressFile | null
  hasReport: boolean
  arbitrations: number
}

function runDirOf(id: string): string | null {
  return RUN_ID_RE.test(id) ? path.join(outputDir(loadConfig()), id) : null
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T
  } catch {
    return null
  }
}

/** The run holding the lock file: started by this server or from the command line */
function lockedRun(): string | null {
  const held = readLock(outputDir(loadConfig()))
  return held ? path.basename(held.runDir) : null
}

function listRuns(): BenchRunSummary[] {
  const dir = outputDir(loadConfig())
  const locked = lockedRun()
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter(name => RUN_ID_RE.test(name) && fs.statSync(path.join(dir, name)).isDirectory())
    .sort().reverse()
    .map(id => {
      const runDir = path.join(dir, id)
      const progress = readJson<ProgressFile>(path.join(runDir, FILES.progress))
      const sample = readJson<SampleFile>(path.join(runDir, FILES.sample))
      const arb = readJson<{ items?: Record<string, string> }>(path.join(runDir, FILES.arbitrations))
      const running = childRun === id || locked === id
      return {
        id,
        running,
        trial: sample?.trial ?? progress?.trial ?? false,
        articles: sample?.articles.length ?? 0,
        // A run left "running" by a dead process (server restart) reads as stopped
        progress: progress && progress.status === 'running' && !running ? { ...progress, status: 'stopped' } : progress,
        hasReport: fs.existsSync(path.join(runDir, FILES.report)),
        arbitrations: Object.keys(arb?.items ?? {}).length,
      }
    })
}

/** run.ts next to this file: .ts under tsx (dev), .js in the compiled server */
function entryPoint(): string {
  const self = fileURLToPath(import.meta.url)
  return path.join(path.dirname(self), `run${path.extname(self)}`)
}

function start(id: string, env: Record<string, string>): void {
  const runDir = path.join(outputDir(loadConfig()), id)
  fs.mkdirSync(runDir, { recursive: true })
  const out = fs.openSync(path.join(runDir, FILES.log), 'a')
  // Reuse the loader flags (tsx in dev), never a debugger port
  const execArgv = process.execArgv.filter(a => !a.startsWith('--inspect'))
  const proc = spawn(process.execPath, [...execArgv, entryPoint()], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, NOTJEV_BENCH_RUN_DIR: runDir, ...env },
    stdio: ['ignore', out, out],
  })
  fs.closeSync(out)
  child = proc
  childRun = id
  log.info(`bench ${id} started (pid ${proc.pid})`)
  proc.on('exit', code => {
    log.info(`bench ${id} exited with code ${code}`)
    if (child === proc) {
      child = null
      childRun = null
    }
  })
}

function busy(reply: FastifyReply): boolean {
  const running = child ? childRun : lockedRun()
  if (!running) return false
  reply.status(409).send({ error: `A bench run is already in progress (${running})` })
  return true
}

const StartBody = z.object({ trial: z.boolean() })
const ArbitrationsBody = z.object({
  version: z.literal(1).optional(),
  run: z.string().optional(),
  items: z.record(z.string(), z.enum(['notjev', 'reference', 'neither'])),
})

export async function notjevBenchRoutes(api: FastifyInstance): Promise<void> {
  api.get('/api/classification/bench', async (_request, reply) => {
    const cfg = loadConfig()
    reply.send({ running: childRun ?? lockedRun(), runs: listRuns(), sampleSize: cfg.sampleSize, trialSize: cfg.trialSize })
  })

  api.post('/api/classification/bench/start', { preHandler: [requireJson] }, async (request, reply) => {
    const body = parseOrBadRequest(StartBody, request.body, reply)
    if (!body || busy(reply)) return
    const id = newRunId()
    start(id, { NOTJEV_BENCH_TRIAL: body.trial ? '1' : '0' })
    reply.send({ id })
  })

  api.post<{ Params: { id: string } }>('/api/classification/bench/runs/:id/resume', async (request, reply) => {
    const runDir = runDirOf(request.params.id)
    if (!runDir || !fs.existsSync(path.join(runDir, FILES.snapshot))) {
      reply.status(404).send({ error: 'Unknown run' })
      return
    }
    if (busy(reply)) return
    start(request.params.id, {})
    reply.send({ id: request.params.id })
  })

  // Arbitrations exported from a report: stored with the run, report recomputed without calls
  api.post<{ Params: { id: string } }>('/api/classification/bench/runs/:id/arbitrations', { preHandler: [requireJson] }, async (request, reply) => {
    const runDir = runDirOf(request.params.id)
    if (!runDir || !fs.existsSync(path.join(runDir, FILES.sample))) {
      reply.status(404).send({ error: 'Unknown run' })
      return
    }
    const body = parseOrBadRequest(ArbitrationsBody, request.body, reply)
    if (!body || busy(reply)) return
    const file = path.join(runDir, FILES.arbitrations)
    fs.writeFileSync(file, JSON.stringify({ version: 1, run: request.params.id, items: body.items }, null, 1))
    start(request.params.id, { NOTJEV_BENCH_ARBITRATIONS: file })
    reply.send({ id: request.params.id, arbitrations: Object.keys(body.items).length })
  })

  api.post('/api/classification/bench/stop', async (_request, reply) => {
    if (!child) {
      reply.status(409).send({ error: 'No bench run in progress' })
      return
    }
    child.kill('SIGTERM')
    reply.send({ ok: true })
  })

  api.get<{ Params: { id: string } }>('/api/classification/bench/runs/:id/report', async (request, reply) => {
    const runDir = runDirOf(request.params.id)
    const file = runDir && path.join(runDir, FILES.report)
    if (!file || !fs.existsSync(file)) {
      reply.status(404).send({ error: 'No report for this run yet' })
      return
    }
    reply.type('text/html; charset=utf-8').send(fs.readFileSync(file, 'utf8'))
  })
}
