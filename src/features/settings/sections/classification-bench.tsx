import { useRef, useState } from 'react'
import useSWR from 'swr'
import { toast } from 'sonner'
import { FileUp, FlaskConical, Loader2, Play, Square, ExternalLink, Tags } from 'lucide-react'
import { fetcher, apiPost, authHeaders } from '../../../lib/fetcher'
import { useI18n } from '@/i18n'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

interface BenchProgress {
  status: 'running' | 'done' | 'error' | 'stopped'
  phase: string
  message: string
  callsTotal: number
  callsDone: number
  errors: number
  startedAt?: string
}

interface BenchRun {
  id: string
  running: boolean
  trial: boolean
  articles: number
  progress: BenchProgress | null
  hasReport: boolean
  arbitrations: number
  labels?: number
}

interface BenchOverview {
  running: string | null
  runs: BenchRun[]
  sampleSize: number
  trialSize: number
}

const STATUS_KEY = {
  running: 'classification.bench.status.running',
  done: 'classification.bench.status.done',
  error: 'classification.bench.status.error',
  stopped: 'classification.bench.status.stopped',
} as const

const buttonClass = 'inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg border border-border text-text hover:bg-hover transition-colors disabled:opacity-50'
const smallButtonClass = 'inline-flex items-center gap-1 px-2 py-1 text-xs rounded-lg border border-border text-text hover:bg-hover transition-colors disabled:opacity-50'

/** "notjev-bench-2026-11-03T10-20-30-000Z" → a local date and time */
function runDate(id: string): string {
  const m = id.match(/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})/)
  if (!m) return id
  const d = new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`)
  return Number.isNaN(d.getTime()) ? id : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(d)
}

/**
 * Accuracy bench of the classification: runs the production questions again
 * on a snapshot of the database, with permuted options and a reasoned
 * reference, and writes an HTML report.
 */
export function ClassificationBench() {
  const { t } = useI18n()
  const { data, mutate } = useSWR<BenchOverview>('/api/classification/bench', fetcher, { refreshInterval: 5_000 })
  const [confirmFull, setConfirmFull] = useState(false)
  const [busy, setBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  // One hidden file input for both imports: which run, and which kind of file
  const [importFor, setImportFor] = useState<{ id: string; kind: 'arbitrations' | 'labels' } | null>(null)

  async function call(url: string, body?: unknown) {
    setBusy(true)
    try {
      await apiPost(url, body)
      await mutate()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function openReport(id: string) {
    // Opened first, synchronously, so the popup is not blocked; the report needs the auth header
    const win = window.open('', '_blank')
    try {
      const res = await fetch(`/api/classification/bench/runs/${encodeURIComponent(id)}/report`, { headers: authHeaders() })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const url = URL.createObjectURL(new Blob([await res.text()], { type: 'text/html' }))
      if (win) win.location.href = url
      else window.location.href = url
    } catch (err) {
      win?.close()
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  async function importFile(file: File) {
    const target = importFor
    setImportFor(null)
    if (!target) return
    try {
      const parsed = JSON.parse(await file.text()) as unknown
      await call(`/api/classification/bench/runs/${encodeURIComponent(target.id)}/${target.kind}`, parsed)
      toast.success(t(target.kind === 'labels' ? 'classification.bench.labelsImported' : 'classification.bench.arbitrationsImported'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  function pick(id: string, kind: 'arbitrations' | 'labels') {
    setImportFor({ id, kind })
    fileInput.current?.click()
  }

  if (!data) return null
  const running = data.runs.find(r => r.running)
  const recent = data.runs.slice(0, 5)

  const statusText = (r: BenchRun) => {
    const p = r.progress
    if (!p) return '–'
    const calls = p.callsTotal ? ` · ${p.callsDone}/${p.callsTotal}` : ''
    return `${t(STATUS_KEY[p.status])}${calls}${p.errors ? ` · ${t('classification.bench.errors', { count: String(p.errors) })}` : ''}`
  }

  return (
    <div className="mt-5">
      <p className="text-sm text-text mb-1">{t('classification.bench.title')}</p>
      <p className="text-xs text-muted mb-2">{t('classification.bench.desc')}</p>

      {running ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-text">
          <Loader2 size={14} className="animate-spin" />
          <span>{t('classification.bench.running', { phase: running.progress?.phase ?? '' })} {statusText(running)}</span>
          <button type="button" disabled={busy} onClick={() => { void call('/api/classification/bench/stop') }} className={smallButtonClass}>
            <Square size={12} />
            {t('classification.bench.stop')}
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => { void call('/api/classification/bench/start', { trial: true }) }} className={buttonClass}>
            <FlaskConical size={14} />
            {t('classification.bench.runTrial', { count: String(data.trialSize) })}
          </button>
          <button type="button" disabled={busy} onClick={() => setConfirmFull(true)} className={buttonClass}>
            <Play size={14} />
            {t('classification.bench.runFull', { count: String(data.sampleSize) })}
          </button>
        </div>
      )}

      {recent.length > 0 && (
        <ul className="mt-3 space-y-2">
          {recent.map(r => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-text">{runDate(r.id)}</span>
              <span className="text-muted">
                {r.trial ? t('classification.bench.trial') : t('classification.bench.full')} · {t('classification.bench.articles', { count: String(r.articles) })} · {statusText(r)}
                {r.arbitrations > 0 && ` · ${t('classification.bench.arbitrations', { count: String(r.arbitrations) })}`}
                {(r.labels ?? 0) > 0 && ` · ${t('classification.bench.labels', { count: String(r.labels) })}`}
              </span>
              {r.hasReport && (
                <button type="button" onClick={() => { void openReport(r.id) }} className={smallButtonClass}>
                  <ExternalLink size={12} />
                  {t('classification.bench.openReport')}
                </button>
              )}
              {!r.running && !running && r.progress?.status !== 'done' && (
                <button type="button" disabled={busy} onClick={() => { void call(`/api/classification/bench/runs/${encodeURIComponent(r.id)}/resume`) }} className={smallButtonClass}>
                  <Play size={12} />
                  {t('classification.bench.resume')}
                </button>
              )}
              {r.hasReport && !running && (
                <>
                  <button type="button" disabled={busy} onClick={() => pick(r.id, 'arbitrations')} className={smallButtonClass}>
                    <FileUp size={12} />
                    {t('classification.bench.importArbitrations')}
                  </button>
                  <button type="button" disabled={busy} onClick={() => pick(r.id, 'labels')} className={smallButtonClass}>
                    <Tags size={12} />
                    {t('classification.bench.importLabels')}
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void importFile(file)
        }}
      />

      {confirmFull && (
        <ConfirmDialog
          title={t('classification.bench.runFull', { count: String(data.sampleSize) })}
          message={t('classification.bench.confirmFull', { count: String(data.sampleSize) })}
          onConfirm={() => { setConfirmFull(false); void call('/api/classification/bench/start', { trial: false }) }}
          onCancel={() => setConfirmFull(false)}
        />
      )}
    </div>
  )
}
