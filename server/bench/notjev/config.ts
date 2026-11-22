import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DATA_DIR, findProjectRoot } from '../../paths.js'

/**
 * Configuration of the notjev accuracy bench. Lives in
 * scripts/notjev-bench.config.json; every key is optional and falls back to
 * the defaults below (the Docker image ships no scripts/ folder, so the
 * settings button runs on these defaults there).
 *
 * The settings UI passes a few overrides through the environment
 * (NOTJEV_BENCH_*), never through command-line arguments.
 */
export interface BenchConfig {
  /** Articles per full run */
  sampleSize: number
  /** Trial mode: a short first pass of `trialSize` articles */
  trial: boolean
  trialSize: number
  /** Seed for sampling and option permutations */
  seed: number
  /** Articles in flight at once (the inference server is shared) */
  concurrency: number
  /** Production database; empty = the server's own (DATABASE_URL or DATA_DIR/rss.db) */
  sourceDb: string
  /** Where run folders are created; empty = the data directory */
  outputDir: string
  /** Existing run folder to resume or re-report; empty = start a new run */
  runDir: string
  /** Arbitrations exported from a report; set = recompute the report, no calls */
  arbitrationsFile: string
  /** Blind importance labels exported from the report's labeling page; set = recompute the report, no calls */
  labelsFile: string
  /** Ask the importance question in its 3 option rotations (2 extra calls per article) */
  rotations: boolean
  /** Articles on the labeling page, and the quota per verdict stratum */
  labeling: { size: number; perStratum: number }
  /** Recording in the `notjev replay` format, relative to the run folder */
  replayFile: string
  /** Theta values of the coverage / agreement curve */
  thetas: number[]
  reasoning: {
    maxTokens: number
    timeoutMs: number
    temperature: number
    /** Replaces notjev's "Reply with only its letter" line; nothing else in the prompt changes */
    instruction: string
  }
}

export const DEFAULT_CONFIG: BenchConfig = {
  sampleSize: 300,
  trial: false,
  trialSize: 20,
  seed: 20261103,
  concurrency: 1,
  sourceDb: '',
  outputDir: '',
  runDir: '',
  arbitrationsFile: '',
  labelsFile: '',
  rotations: true,
  labeling: { size: 60, perStratum: 15 },
  replayFile: 'replay.json',
  thetas: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9],
  reasoning: {
    maxTokens: 4096,
    timeoutMs: 300_000,
    temperature: 0.6,
    instruction: 'Choose the correct option. Think it through first, then end your reply with a final line of the form "Answer: X", where X is the letter of the option.',
  },
}

export const RUN_PREFIX = 'notjev-bench-'
export const RUN_ID_RE = /^notjev-bench-[0-9TZ-]+$/

const here = path.dirname(fileURLToPath(import.meta.url))
export const PROJECT_ROOT = findProjectRoot(here)
export const CONFIG_PATH = path.join(PROJECT_ROOT, 'scripts', 'notjev-bench.config.json')

function resolveFrom(root: string, p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(root, p)
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BenchConfig {
  let file: Partial<BenchConfig> = {}
  const configPath = env.NOTJEV_BENCH_CONFIG || CONFIG_PATH
  if (fs.existsSync(configPath)) {
    file = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Partial<BenchConfig>
  }
  const cfg: BenchConfig = {
    ...DEFAULT_CONFIG,
    ...file,
    reasoning: { ...DEFAULT_CONFIG.reasoning, ...(file.reasoning ?? {}) },
    labeling: { ...DEFAULT_CONFIG.labeling, ...(file.labeling ?? {}) },
  }
  // Overrides set by the settings UI when it starts a run
  if (env.NOTJEV_BENCH_RUN_DIR) cfg.runDir = env.NOTJEV_BENCH_RUN_DIR
  if (env.NOTJEV_BENCH_TRIAL) cfg.trial = env.NOTJEV_BENCH_TRIAL === '1'
  if (env.NOTJEV_BENCH_ARBITRATIONS) cfg.arbitrationsFile = env.NOTJEV_BENCH_ARBITRATIONS
  if (env.NOTJEV_BENCH_LABELS) cfg.labelsFile = env.NOTJEV_BENCH_LABELS
  cfg.concurrency = Math.max(1, Math.floor(cfg.concurrency))
  return cfg
}

export function outputDir(cfg: BenchConfig): string {
  return cfg.outputDir ? resolveFrom(PROJECT_ROOT, cfg.outputDir) : DATA_DIR
}

export function newRunId(now = new Date()): string {
  return RUN_PREFIX + now.toISOString().replace(/[:.]/g, '-')
}

export function resolveRunDir(cfg: BenchConfig): string {
  return cfg.runDir ? resolveFrom(PROJECT_ROOT, cfg.runDir) : path.join(outputDir(cfg), newRunId())
}

export function resolveArbitrations(cfg: BenchConfig): string | null {
  return cfg.arbitrationsFile ? resolveFrom(PROJECT_ROOT, cfg.arbitrationsFile) : null
}

export function resolveLabels(cfg: BenchConfig): string | null {
  return cfg.labelsFile ? resolveFrom(PROJECT_ROOT, cfg.labelsFile) : null
}

/** File names inside a run folder */
export const FILES = {
  snapshot: 'snapshot.db',
  sample: 'sample.json',
  results: 'results.jsonl',
  progress: 'progress.json',
  report: 'report.html',
  arbitrations: 'arbitrations.json',
  labels: 'labels.json',
  log: 'bench.log',
} as const
