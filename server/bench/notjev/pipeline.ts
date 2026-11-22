import fs from 'node:fs'
import path from 'node:path'
import type { BenchConfig } from './config.js'
import { FILES } from './config.js'
import { buildSample } from './sample.js'
import { BenchRunner, loadResults } from './calls.js'
import { analyze, replayRecording } from './analyze.js'
import { renderReport } from './report.js'
import { getDb } from '../../db/connection.js'
import { NO_THEME_KEY } from '../../../shared/journal.js'
import { parseTs } from './importance.js'
import {
  IMPORTANCE_LABELS,
  callsPerArticle,
  type ArbitrationFile,
  type ImportanceContext,
  type ImportanceLabel,
  type LabelsFile,
  type ProgressFile,
  type SampleFile,
} from './types.js'

/**
 * Everything after the snapshot. Imported dynamically by run.ts once
 * DATABASE_URL points at the snapshot, since it pulls in the production
 * database modules.
 */

interface PipelineOptions {
  cfg: BenchConfig
  runDir: string
  arbitrationsFile: string | null
  labelsFile: string | null
  reportOnly: boolean
  progress: (patch: Partial<ProgressFile>) => void
}

function readArbitrations(file: string | null, runId: string): ArbitrationFile['items'] {
  if (!file || !fs.existsSync(file)) return {}
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<ArbitrationFile>
  if (parsed.run && parsed.run !== runId) {
    console.warn(`Arbitrations were exported from run ${parsed.run}, not ${runId}: only matching article/question keys apply`)
  }
  return parsed.items ?? {}
}

function readLabels(file: string | null, runId: string): Record<string, ImportanceLabel> {
  if (!file || !fs.existsSync(file)) return {}
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<LabelsFile>
  if (parsed.run && parsed.run !== runId) {
    console.warn(`Labels were exported from run ${parsed.run}, not ${runId}: only matching article ids apply`)
  }
  // Anything else than the four answers is ignored
  return Object.fromEntries(Object.entries(parsed.items ?? {}).filter(([, v]) => IMPORTANCE_LABELS.includes(v)))
}

/** A file given in the config is copied next to the run; without one, the copy made earlier is read */
function adopt(file: string | null, own: string): string | null {
  if (file) {
    if (path.resolve(file) !== own) fs.copyFileSync(file, own)
    return own
  }
  return fs.existsSync(own) ? own : null
}

/**
 * What the snapshot says about the reader context each importance question
 * was built from: the stored theme's instruction date and its votes cast
 * after the article was classified. Read-only, on the snapshot.
 */
function importanceContexts(sample: SampleFile): Map<number, ImportanceContext> {
  const db = getDb()
  const out = new Map<number, ImportanceContext>()
  const instruction = db.prepare('SELECT updated_at FROM journal_instructions WHERE theme = ?')
  const votes = db.prepare("SELECT created_at FROM journal_feedback WHERE COALESCE(theme, '') = COALESCE(?, '')")
  for (const a of sample.articles) {
    if (!a.stored.classifiedAt) continue
    const theme = a.stored.theme
    let updatedAt: string | null = null
    let after = 0
    try {
      // Keyed as getReaderContext() reads it: no theme and OTHER share the no-theme bucket
      const key = theme && theme !== 'OTHER' ? theme : NO_THEME_KEY
      updatedAt = (instruction.get(key) as { updated_at: string } | undefined)?.updated_at ?? null
      const since = parseTs(a.stored.classifiedAt)
      after = (votes.all(theme) as Array<{ created_at: string }>).filter(v => parseTs(v.created_at) > since).length
    } catch {
      // Snapshot older than the journal (migration 0021): no context to compare
    }
    out.set(a.id, { articleId: a.id, theme, instructionUpdatedAt: updatedAt, votesAfter: after })
  }
  return out
}

function importanceSince(): string | null {
  const row = getDb().prepare("SELECT applied_at FROM _migrations WHERE name = '0022_article_importance.sql'").get() as { applied_at: string } | undefined
  return row?.applied_at ?? null
}

export async function runPipeline({ cfg, runDir, arbitrationsFile, labelsFile, reportOnly, progress }: PipelineOptions): Promise<void> {
  // Never against the production database: run.ts points DATABASE_URL at the snapshot first
  const snapshotUrl = `file:${path.join(runDir, FILES.snapshot)}`
  if (process.env.DATABASE_URL !== snapshotUrl) {
    throw new Error(`The bench pipeline must read ${snapshotUrl}, not ${process.env.DATABASE_URL ?? 'the default database'}`)
  }
  const runId = path.basename(runDir)
  const samplePath = path.join(runDir, FILES.sample)
  const resultsPath = path.join(runDir, FILES.results)

  progress({ phase: 'sample' })
  let sample: SampleFile
  if (fs.existsSync(samplePath)) {
    sample = JSON.parse(fs.readFileSync(samplePath, 'utf8')) as SampleFile
  } else {
    sample = buildSample(cfg)
    fs.writeFileSync(samplePath, JSON.stringify(sample, null, 1))
    console.log(`Sample: ${sample.articles.length} articles (${sample.counts.labeledUsed} labeled, ${sample.counts.excludedAsInjectedExamples} excluded as importance examples)`)
  }

  const results = loadResults(resultsPath)
  const callsTotal = sample.articles.length * callsPerArticle(cfg.rotations)
  let errors = 0
  progress({ phase: 'calls', trial: sample.trial, articlesTotal: sample.articles.length, callsTotal, callsDone: results.size, errors })

  if (!reportOnly) {
    let lastWrite = 0
    const runner = new BenchRunner(cfg, results, resultsPath, () => {
      // Throttled: the settings page polls this file
      if (Date.now() - lastWrite < 1000) return
      lastWrite = Date.now()
      progress({ callsDone: results.size, errors })
    })
    console.log(`Calls: ${results.size}/${callsTotal} already recorded, concurrency ${cfg.concurrency}`)
    let next = 0
    const worker = async () => {
      while (next < sample.articles.length) {
        const a = sample.articles[next++]
        try {
          await runner.runArticle(a.id)
        } catch (err) {
          // Nothing recorded for the failed call: the next run makes it again
          errors++
          console.warn(`article ${a.id}: ${err instanceof Error ? err.message : String(err)}`)
        }
        console.log(`${results.size}/${callsTotal} calls`)
      }
    }
    await Promise.all(Array.from({ length: Math.min(cfg.concurrency, sample.articles.length) }, worker))
    progress({ callsDone: results.size, errors })
  }

  progress({ phase: 'report' })
  // Kept next to the run, so a later resume or re-report sees the same choices
  const arbitrations = readArbitrations(adopt(arbitrationsFile, path.join(runDir, FILES.arbitrations)), runId)
  const labels = readLabels(adopt(labelsFile, path.join(runDir, FILES.labels)), runId)
  const analysis = analyze(sample, results, cfg.thetas, arbitrations, {
    seed: cfg.seed,
    rotations: cfg.rotations,
    labeling: cfg.labeling,
    labels,
    contexts: importanceContexts(sample),
    importanceSince: importanceSince(),
  })
  const t = analysis.totals
  const wall = t.firstCallAt && t.lastCallAt ? Date.parse(t.lastCallAt) - Date.parse(t.firstCallAt) : 0
  fs.writeFileSync(path.join(runDir, FILES.report), renderReport(runId, sample, analysis, cfg.thetas, wall, labels))
  fs.writeFileSync(path.join(runDir, cfg.replayFile), JSON.stringify(replayRecording(sample, results)))

  const missing = callsTotal - results.size
  progress({
    status: missing > 0 ? 'error' : 'done',
    message: missing > 0 ? `${missing} call(s) missing: resume the run to make them` : '',
    callsDone: results.size,
    errors,
    finishedAt: new Date().toISOString(),
  })
  console.log(`Report: ${path.join(runDir, FILES.report)}${missing > 0 ? ` (${missing} calls missing)` : ''}`)
}
