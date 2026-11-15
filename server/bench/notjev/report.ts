import type { Analysis, QuestionAnalysis, Rate, SweepPoint } from './analyze.js'
import type { SampleFile } from './types.js'
import { importanceSections, labelingData, labelingView, LABELING_CSS, LABELING_JS } from './report-importance.js'

/**
 * The report: one self-contained HTML file (no server, no CDN). Charts are
 * inline SVG; arbitrations live in the browser's localStorage and are
 * exported as a JSON file the bench reads back.
 */

const esc = (s: unknown): string => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const pct = (r: Rate): string => r.n ? `${(100 * r.hit / r.n).toFixed(1)} %` : '–'
const pctN = (r: Rate): string => r.n ? `${pct(r)} <span class="muted">(${r.hit}/${r.n})</span>` : '<span class="muted">no data</span>'
const fmtMs = (ms: number): string => ms >= 60_000 ? `${(ms / 60_000).toFixed(1)} min` : ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`

const QUESTION_TITLE: Record<string, string> = { format: 'Format', theme: 'Theme', importance: 'Importance' }

interface Series { name: string; cls: string; points: Array<{ x: number; y: number | null }> }

function lineChart(series: Series[], marker: number, xs: number[]): string {
  const W = 560, H = 240, L = 44, R = 12, T = 12, B = 34
  const x = (v: number) => L + (v - xs[0]) / ((xs[xs.length - 1] - xs[0]) || 1) * (W - L - R)
  const y = (v: number) => T + (1 - v) * (H - T - B)
  const grid = [0, 0.25, 0.5, 0.75, 1].map(v =>
    `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v * 100}%</text>`).join('')
  const ticks = xs.map(v => `<text class="axis" x="${x(v)}" y="${H - B + 16}" text-anchor="middle">${v}</text>`).join('')
  const lines = series.map(s => {
    const pts = s.points.filter(p => p.y !== null)
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.x).toFixed(1)},${y(p.y!).toFixed(1)}`).join('')
    const dots = pts.map(p => `<circle class="${s.cls}" cx="${x(p.x).toFixed(1)}" cy="${y(p.y!).toFixed(1)}" r="3"><title>${s.name} at theta ${p.x}: ${(100 * p.y!).toFixed(1)} %</title></circle>`).join('')
    return `<path class="${s.cls}" d="${d}" fill="none"/>${dots}`
  }).join('')
  const mk = `<line class="marker" x1="${x(marker)}" x2="${x(marker)}" y1="${T}" y2="${H - B}"/><text class="axis marker-text" x="${x(marker) + 4}" y="${T + 10}">current ${marker}</text>`
  const legend = series.map(s => `<span class="legend"><i class="${s.cls}"></i>${esc(s.name)}</span>`).join('')
  return `<figure><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="theta curve">${grid}${ticks}${mk}${lines}<text class="axis" x="${(W + L) / 2}" y="${H - 4}" text-anchor="middle">theta</text></svg><figcaption>${legend}</figcaption></figure>`
}

function bars(counts: Record<string, number>, keys: string[]): string {
  const total = keys.reduce((a, k) => a + (counts[k] ?? 0), 0) || 1
  return `<div class="bars">${keys.map(k => {
    const n = counts[k] ?? 0
    return `<div class="bar-row"><span class="bar-key">${esc(k)}</span><span class="bar"><span style="width:${(100 * n / total).toFixed(1)}%"></span></span><span class="bar-val">${n} <span class="muted">(${(100 * n / total).toFixed(0)} %)</span></span></div>`
  }).join('')}</div>`
}

function confusion(q: QuestionAnalysis): string {
  const { rows, cols, cells } = q.confusion
  const max = Math.max(1, ...cells.flat())
  const keepRow = rows.map((_, i) => cells[i].some(v => v > 0))
  const keepCol = cols.map((_, j) => cells.some(r => r[j] > 0))
  const head = cols.map((c, j) => keepCol[j] ? `<th>${esc(c)}</th>` : '').join('')
  const body = rows.map((r, i) => !keepRow[i] ? '' : `<tr><th>${esc(r)}</th>${cols.map((c, j) => {
    if (!keepCol[j]) return ''
    const v = cells[i][j]
    const diag = r === c
    return `<td class="${diag ? 'diag' : ''}" style="--a:${(v / max).toFixed(3)}">${v || ''}</td>`
  }).join('')}</tr>`).join('')
  return `<div class="scroll"><table class="confusion"><thead><tr><th class="corner">notjev ↓ · reference →</th>${head}</tr></thead><tbody>${body}</tbody></table></div>`
}

function sweepSeries(q: QuestionAnalysis): Series[] {
  const s: Series[] = [
    { name: '% decided', cls: 's1', points: q.sweep.map(p => ({ x: p.theta, y: p.decidedPct })) },
    { name: q.arbitrated ? 'accuracy (arbitrated) among decided' : 'agreement with reference among decided', cls: 's2', points: q.sweep.map(p => ({ x: p.theta, y: p.agree.n ? p.agree.hit / p.agree.n : null })) },
  ]
  if (q.question === 'importance') {
    const f = (k: 'strict' | 'soft') => (p: SweepPoint) => ({ x: p.theta, y: p[k]?.n ? p[k]!.hit / p[k]!.n : null })
    s.push({ name: 'label accuracy, strict', cls: 's3', points: q.sweep.map(f('strict')) })
    s.push({ name: 'label accuracy, soft', cls: 's4', points: q.sweep.map(f('soft')) })
  }
  return s
}

function questionSection(q: QuestionAnalysis, thetas: number[]): string {
  const letters = Array.from(new Set([...Object.keys(q.position.lettersProduction), ...Object.keys(q.position.lettersShuffled)])).sort()
  const labels = q.labels ? `
    <h3>Importance against your labels</h3>
    <p class="muted">Positive = vote +1, liked or bookmarked (${q.labels.positives}); negative = vote −1 (${q.labels.negatives}); ${q.labels.conflicts} conflicting article(s) left out. An undecided verdict counts as USEFUL, as the journal applies it.</p>
    <table class="kv"><thead><tr><th></th><th>notjev</th><th>null arm (constant answer)</th><th>reasoned reference</th></tr></thead><tbody>
      <tr><th>Strict (positive = ESSENTIAL, negative = SKIP)</th><td>${pctN(q.labels.strict)}</td><td>${pctN(q.labels.nullStrict)}</td><td>${pctN(q.labels.refStrict)}</td></tr>
      <tr><th>Soft (positive = ESSENTIAL or USEFUL, negative = SKIP)</th><td>${pctN(q.labels.soft)}</td><td>${pctN(q.labels.nullSoft)}</td><td>${pctN(q.labels.refSoft)}</td></tr>
    </tbody></table>` : ''
  const repro = q.repro.mismatches.slice(0, 15).map(m => `<li>#${m.articleId} ${esc(m.title)} — stored <b>${esc(m.stored)}</b>, now <b>${esc(m.now)}</b></li>`).join('')
  return `
  <section id="q-${q.question}">
    <h2>${QUESTION_TITLE[q.question]} <span class="muted">theta ${q.theta}</span></h2>
    <div class="cards">
      <div class="card"><div class="big">${pct(q.agreeDecided)}</div><div>agreement with the reference, decided verdicts</div><div class="muted">${q.agreeDecided.hit}/${q.agreeDecided.n}</div></div>
      <div class="card"><div class="big">${pct(q.nullArm.rate)}</div><div>null arm: always <b>${esc(q.nullArm.cls)}</b></div><div class="muted">${q.nullArm.rate.hit}/${q.nullArm.rate.n}</div></div>
      <div class="card"><div class="big">${pct(q.agreeTop)}</div><div>agreement of the top answer (theta 0)</div><div class="muted">${q.agreeTop.hit}/${q.agreeTop.n}</div></div>
      ${q.arbitrated ? `<div class="card accent"><div class="big">${pct(q.arbitrated.notjev)}</div><div>notjev accuracy after your arbitrations (reference ${pct(q.arbitrated.reference)})</div><div class="muted">${q.arbitrated.total - q.arbitrated.pending}/${q.arbitrated.total} disagreements arbitrated</div></div>` : ''}
    </div>
    <p class="muted">${q.articles} articles · ${q.undecided} undecided at the current theta · ${q.degraded} degraded · reference: ${q.reference.ok} readable, ${q.reference.unreadable} unreadable, ${q.reference.truncated} truncated, ${q.reference.missing} missing.</p>
    ${labels}
    <h3>Confusion matrix</h3>
    ${confusion(q)}
    <h3>Theta curve</h3>
    <p class="muted">Computed offline from the recorded distributions.</p>
    ${lineChart(sweepSeries(q), q.theta, thetas)}
    <h3>Accuracy by band</h3>
    <table class="kv"><thead><tr><th>band (p1)</th><th>agreement of the top answer</th></tr></thead><tbody>
      ${q.bands.map(b => `<tr><th>${b.band}</th><td>${pctN(b.agree)}</td></tr>`).join('')}
    </tbody></table>
    <h3>Position bias</h3>
    <p>Verdict changes when the options are permuted: top answer ${pctN(q.position.changedTop)}, decided verdicts ${pctN(q.position.changedChoice)}.</p>
    <div class="two">
      <div><h4>Letters chosen, production order</h4>${bars(q.position.lettersProduction, letters)}</div>
      <div><h4>Letters chosen, permuted order</h4>${bars(q.position.lettersShuffled, letters)}</div>
    </div>
    <h3>Coverage and time</h3>
    <div class="two">
      <div><h4>Coverage (option mass) · mean ${q.coverage.mean.toFixed(4)}</h4>${bars(Object.fromEntries(q.coverage.hist.map(h => [h.label, h.count])), q.coverage.hist.map(h => h.label))}</div>
      <div><h4>Time per call</h4><table class="kv"><tbody>
        <tr><th>notjev (one token)</th><td>mean ${fmtMs(q.ms.production.mean)} · median ${fmtMs(q.ms.production.median)}</td></tr>
        <tr><th>reasoned reference</th><td>mean ${fmtMs(q.ms.reasoned.mean)} · median ${fmtMs(q.ms.reasoned.median)}</td></tr>
      </tbody></table></div>
    </div>
    <h3>Reproducibility against stored values</h3>
    <p>Same verdict as <code>articles.${q.question}</code> today: ${pctN(q.repro)}.${q.question === 'importance' ? ' <span class="muted">Importance also depends on your votes and instructions, which may have changed since the article was classified.</span>' : ''}</p>
    ${repro ? `<details><summary>${q.repro.mismatches.length} mismatch(es)</summary><ul>${repro}</ul></details>` : ''}
  </section>`
}

export function renderReport(
  runId: string,
  sample: SampleFile,
  a: Analysis,
  thetas: number[],
  durationMs: number,
  labels: Record<string, string> = {},
): string {
  const s = sample.settings
  const t = a.totals
  const disagreements = a.questions.flatMap(q => q.disagreements)
  const data = JSON.stringify({ run: runId, disagreements, arbitrations: a.arbitrations }).replace(/</g, '\\u003c')
  const labelingJson = JSON.stringify({ run: runId, ...labelingData(a.importance, labels) }).replace(/</g, '\\u003c')
  const summary = a.questions.map(q => `<tr><th><a href="#q-${q.question}">${QUESTION_TITLE[q.question]}</a></th><td>${q.articles ? `${(100 * (q.articles - q.undecided) / q.articles).toFixed(0)} %` : '–'}</td><td>${pctN(q.agreeDecided)}</td><td>${pctN(q.nullArm.rate)}</td><td>${pctN(q.position.changedTop)}</td><td>${q.arbitrated ? pct(q.arbitrated.notjev) : '–'}</td></tr>`).join('')

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>notjev accuracy bench</title>
<style>
:root{--bg:#fbfaf8;--card:#fff;--text:#1d1d1b;--muted:#6b6a66;--border:#e3e1dc;--accent:#2f6fde;--good:#2e8b57;--bad:#c2410c;--s1:#8a8a86;--s2:#2f6fde;--s3:#c2410c;--s4:#2e8b57;--s5:#7c3aed;--s6:#b45309;--heat:47,111,222}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#161615;--card:#1f1f1d;--text:#ecebe7;--muted:#a3a29d;--border:#34332f;--accent:#7aa7ff;--good:#5cc28a;--bad:#f08a5d;--s1:#9a9994;--s2:#7aa7ff;--s3:#f08a5d;--s4:#5cc28a;--s5:#b794f6;--s6:#f6c177;--heat:122,167,255}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1080px;margin:0 auto;padding:24px 16px 80px}h1{font-size:24px;margin:0 0 4px}h2{font-size:20px;margin:40px 0 12px;padding-top:16px;border-top:1px solid var(--border)}h3{font-size:16px;margin:24px 0 8px}h4{font-size:14px;margin:8px 0}
.muted{color:var(--muted)}code{font-size:13px}a{color:var(--accent)}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}.card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:12px}.card.accent{border-color:var(--accent)}.big{font-size:26px;font-weight:600;font-variant-numeric:tabular-nums}
table{border-collapse:collapse;font-variant-numeric:tabular-nums}.kv th,.kv td{padding:4px 12px 4px 0;text-align:left;vertical-align:top;border-bottom:1px solid var(--border)}.kv th{font-weight:500}
.scroll{overflow-x:auto}.confusion th,.confusion td{padding:4px 8px;border:1px solid var(--border);text-align:center;font-size:13px;white-space:nowrap}.confusion td{background:rgba(var(--heat),calc(var(--a) * .55))}.confusion td.diag{outline:2px solid var(--good);outline-offset:-2px}.corner{font-weight:400;color:var(--muted)}
figure{margin:0;max-width:600px}svg{width:100%;height:auto}.grid{stroke:var(--border)}.axis{fill:var(--muted);font-size:11px}.marker{stroke:var(--text);stroke-dasharray:4 3}.marker-text{fill:var(--text)}
path.s1,path.s2,path.s3,path.s4{stroke-width:2}path.s1{stroke:var(--s1)}path.s2{stroke:var(--s2)}path.s3{stroke:var(--s3)}path.s4{stroke:var(--s4)}circle.s1{fill:var(--s1)}circle.s2{fill:var(--s2)}circle.s3{fill:var(--s3)}circle.s4{fill:var(--s4)}
.legend{display:inline-flex;align-items:center;gap:6px;margin-right:14px;font-size:13px;color:var(--muted)}.legend i{width:14px;height:3px;display:inline-block}.legend i.s1{background:var(--s1)}.legend i.s2{background:var(--s2)}.legend i.s3{background:var(--s3)}.legend i.s4{background:var(--s4)}
.two{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px}
.bars{display:grid;gap:4px}.bar-row{display:grid;grid-template-columns:90px 1fr 90px;gap:8px;align-items:center;font-size:13px}.bar{height:10px;background:var(--border);border-radius:5px;overflow:hidden}.bar span{display:block;height:100%;background:var(--accent)}.bar-val{font-variant-numeric:tabular-nums}
.toolbar{position:sticky;top:0;background:var(--bg);padding:8px 0;display:flex;flex-wrap:wrap;gap:8px;align-items:center;z-index:1;border-bottom:1px solid var(--border)}
button,select{font:inherit;font-size:13px;padding:4px 10px;border-radius:8px;border:1px solid var(--border);background:var(--card);color:var(--text);cursor:pointer}button.on{background:var(--accent);border-color:var(--accent);color:#fff}
.dis{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:12px;margin:10px 0}.dis .title{font-weight:600}.dis .ex{font-size:13px;color:var(--muted);margin:6px 0}.dis .ans{display:flex;flex-wrap:wrap;gap:16px;font-size:14px;margin:6px 0}.dis .btns{display:flex;flex-wrap:wrap;gap:6px}
.tag{font-size:12px;padding:1px 6px;border-radius:6px;border:1px solid var(--border);color:var(--muted)}
${LABELING_CSS}
</style></head>
<body><main>
${labelingView()}
<div id="report-view">
<h1>notjev accuracy bench</h1>
<p class="muted">Run ${esc(runId)}${sample.trial ? ' · <b>trial mode</b>' : ''} · generated ${esc(new Date().toISOString())}</p>
<table class="kv"><tbody>
<tr><th>Model</th><td><code>${esc(s.model)}</code> <span class="muted">(classify.model: ${esc(s.classifyModel ?? 'unset')}, summary.model: ${esc(s.summaryModel ?? 'unset')})</span></td></tr>
<tr><th>Server</th><td><code>${esc(s.vllmBaseUrl)}</code> <span class="muted">(vllm.base_url: ${esc(s.baseUrlSetting ?? 'unset')}) · API key ${s.apiKeyPresent ? 'present' : 'absent'}</span></td></tr>
<tr><th>Thresholds</th><td>format ${s.formatTheta} · theme ${s.themeTheta} · importance ${s.importanceTheta}</td></tr>
<tr><th>Themes</th><td>${s.themes.map(th => `<span class="tag" title="${esc(th.description)}">${esc(th.id)}</span>`).join(' ')}</td></tr>
<tr><th>Articles</th><td>${t.articles} sampled (${t.articlesComplete} complete) · ${sample.counts.labeledUsed} labeled of ${sample.counts.labeledAvailable} · ${sample.counts.excludedAsInjectedExamples} excluded as importance examples · seed ${sample.seed}</td></tr>
<tr><th>Calls</th><td>${t.calls} · ${t.degradedReadouts} degraded readout(s) · ${t.reasonedUnreadable} unreadable or truncated reference(s)</td></tr>
<tr><th>Duration</th><td>${fmtMs(durationMs)} wall clock · notjev ${fmtMs(t.productionMs + t.shuffledMs)} · rotations ${fmtMs(t.rotationsMs)} · reference ${fmtMs(t.reasonedMs)}</td></tr>
</tbody></table>
<p class="muted">The reasoned reference is the same model with thinking on: agreement with it measures consistency, not truth. Your arbitrations below turn it into accuracy.</p>
${a.importance ? `<p><b>Blind importance labeling:</b> <a href="#labeling" target="_blank" rel="noopener">open the labeling page</a> before reading the per-article lists of this report, which show verdicts.</p>` : ''}

<h2>Summary</h2>
<div class="scroll"><table class="kv"><thead><tr><th></th><th>decided</th><th>agreement (decided)</th><th>null arm</th><th>changes with order</th><th>arbitrated accuracy</th></tr></thead><tbody>${summary}</tbody></table></div>

${a.questions.map(q => questionSection(q, thetas)).join('')}

${importanceSections(a.importance, thetas, lineChart)}

<h2 id="disagreements">Disagreements notjev / reference <span class="muted">(${disagreements.length})</span></h2>
<p class="muted">Your choices are kept in this browser. Export them, then import the file from Settings → Classification (or set <code>arbitrationsFile</code> in the config) to recompute the figures without any new call.</p>
<div class="toolbar">
  <select id="filter"><option value="">all questions</option><option value="format">format</option><option value="theme">theme</option><option value="importance">importance</option></select>
  <select id="show"><option value="">all</option><option value="todo">not arbitrated</option><option value="done">arbitrated</option></select>
  <span id="count" class="muted"></span>
  <button id="export">Export arbitrations (JSON)</button>
  <button id="reset">Clear my choices</button>
</div>
<div id="list"></div>
</div>
</main>
<script type="application/json" id="data">${data}</script>
<script type="application/json" id="labeling-data">${labelingJson}</script>
<script>${LABELING_JS}</script>
<script>
(function(){
  var D = JSON.parse(document.getElementById('data').textContent);
  var KEY = 'notjev-bench:' + D.run;
  // The choices made in this browser; on a first visit, the ones already imported into this report
  var arb = Object.assign({}, D.arbitrations || {});
  try { var saved = localStorage.getItem(KEY); if (saved) arb = JSON.parse(saved) || arb; } catch (e) {}
  function save(){ try { localStorage.setItem(KEY, JSON.stringify(arb)); } catch (e) {} }
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  var LABEL = { notjev: 'notjev is right', reference: 'reference is right', neither: 'neither' };
  function render(){
    var f = document.getElementById('filter').value, sh = document.getElementById('show').value;
    var rows = D.disagreements.filter(function(d){
      var k = d.articleId + '|' + d.question;
      return (!f || d.question === f) && (!sh || (sh === 'done') === !!arb[k]);
    });
    var done = D.disagreements.filter(function(d){ return arb[d.articleId + '|' + d.question]; }).length;
    document.getElementById('count').textContent = done + ' / ' + D.disagreements.length + ' arbitrated';
    document.getElementById('list').innerHTML = rows.map(function(d){
      var k = d.articleId + '|' + d.question;
      return '<div class="dis" data-k="' + esc(k) + '"><div><span class="tag">' + esc(d.question) + '</span> <a class="title" href="' + esc(d.url) + '" target="_blank" rel="noopener">' + esc(d.title) + '</a> <span class="muted">· ' + esc(d.feed || '') + ' · #' + d.articleId + '</span></div>'
        + '<div class="ex">' + esc(d.excerpt) + '</div>'
        + '<div class="ans"><span>notjev: <b>' + esc(d.notjev) + '</b>' + (d.notjevDecided ? '' : ' <span class="muted">(undecided)</span>') + ' <span class="muted">p1 ' + d.p1.toFixed(2) + ' · margin ' + d.margin.toFixed(2) + ' · ' + esc(d.band) + '</span></span><span>reference: <b>' + esc(d.reference) + '</b></span></div>'
        + '<div class="btns">' + ['notjev','reference','neither'].map(function(v){ return '<button data-v="' + v + '" class="' + (arb[k] === v ? 'on' : '') + '">' + LABEL[v] + '</button>'; }).join('') + '</div></div>';
    }).join('') || '<p class="muted">Nothing to show.</p>';
  }
  document.getElementById('list').addEventListener('click', function(e){
    var b = e.target.closest('button[data-v]'); if (!b) return;
    var k = b.closest('.dis').getAttribute('data-k'), v = b.getAttribute('data-v');
    if (arb[k] === v) delete arb[k]; else arb[k] = v;
    save(); render();
  });
  document.getElementById('filter').addEventListener('change', render);
  document.getElementById('show').addEventListener('change', render);
  document.getElementById('export').addEventListener('click', function(){
    var blob = new Blob([JSON.stringify({ version: 1, run: D.run, items: arb }, null, 1)], { type: 'application/json' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'arbitrations-' + D.run + '.json';
    document.body.appendChild(a); a.click(); a.remove();
  });
  document.getElementById('reset').addEventListener('click', function(){
    if (!confirm('Clear every choice kept in this browser for this run?')) return;
    arb = {}; save(); render();
  });
  render();
})();
</script>
</body></html>`
}
