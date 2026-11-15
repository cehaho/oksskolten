import type { ImportanceAnalysis } from './analyze.js'
import type { LabelSweepPoint, ReadingScore, ReadingSummary, WRate } from './importance.js'
import { STRATA, VERDICTS } from './importance.js'

/**
 * Report sections specific to importance: production against rotations,
 * accuracy against the reader's blind labels, the reproducibility diagnosis,
 * and the blind labeling page itself.
 */

const esc = (s: unknown): string => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const p = (hit: number, n: number): string => n ? `${(100 * hit / n).toFixed(1)} %` : '–'
/** Weighted rate, with the raw number of articles it rests on */
const w = (r: WRate | null | undefined): string => !r ? '<span class="muted">–</span>'
  : r.count ? `${p(r.hit, r.n)} <span class="muted">(${r.count} art.)</span>` : '<span class="muted">no data</span>'

export interface ChartSeries { name: string; cls: string; points: Array<{ x: number; y: number | null }> }
type LineChart = (series: ChartSeries[], marker: number, xs: number[]) => string

function summaryRow(name: string, s: ReadingSummary, score: ReadingScore | null): string {
  const d = s.distribution
  return `<tr><th>${name}</th>
    <td>${p(s.articles - s.undecided, s.articles)}</td>
    <td>${p(s.undecided, s.articles)}</td>
    <td>${VERDICTS.map(v => `${v[0]} ${d[v] ?? 0}`).join(' · ')} · ? ${d.UNDECIDED ?? 0}</td>
    <td>${p(s.agreeReference.hit, s.agreeReference.n)} <span class="muted">(${s.agreeReference.hit}/${s.agreeReference.n})</span></td>
    <td>${w(score?.abstention)}<br><span class="muted">coverage ${score ? p(score.coverage.hit, score.coverage.n) : '–'}</span></td>
    <td>${w(score?.asProduction)}</td></tr>`
}

function rotationsSection(a: ImportanceAnalysis): string {
  if (!a.rotationsOn) return ''
  const c = a.rotations
  if (!c) {
    return `<h2 id="imp-rotations">Importance by rotations</h2><p class="muted">No article has its three rotations yet: resume the run to make the 2 extra calls per article.</p>`
  }
  const order = [...STRATA]
  const moves = `<div class="scroll"><table class="confusion"><thead><tr><th class="corner">production ↓ · rotations →</th>${order.map(s => `<th>${s}</th>`).join('')}</tr></thead><tbody>${
    order.map((r, i) => `<tr><th>${r}</th>${order.map((col, j) => `<td class="${r === col ? 'diag' : ''}" style="--a:${(c.moves[i][j] / Math.max(1, c.articles)).toFixed(3)}">${c.moves[i][j] || ''}</td>`).join('')}</tr>`).join('')
  }</tbody></table></div>`
  return `
  <section id="imp-rotations">
    <h2>Importance: production against rotations <span class="muted">theta ${a.theta}</span></h2>
    <p>Candidate fix for the position bias, <b>measured only</b> (classify.ts is unchanged): the importance question asked in its 3 option rotations (ESSENTIAL/USEFUL/SKIP, USEFUL/SKIP/ESSENTIAL, SKIP/ESSENTIAL/USEFUL), each distribution read back onto the option ids, the three averaged, and the same margin rule applied (theta ${a.theta}). A degraded rotation makes the reading undecided.</p>
    <div class="scroll"><table class="kv"><thead><tr><th></th><th>decided</th><th>undecided</th><th>verdicts (E · U · S · ?)</th><th>agreement with the reference (decided)</th><th>accuracy vs your labels, abstention</th><th>accuracy vs your labels, as in production</th></tr></thead><tbody>
      ${summaryRow('production order', c.production, a.labels.production.coverage.count ? a.labels.production : null)}
      ${summaryRow('by rotations', c.rotations, a.labels.rotations)}
    </tbody></table></div>
    <p class="muted">${c.articles} articles with the 3 rotations · ${c.appliedChanged} change applied verdict (undecided read as USEFUL) · degraded: production ${c.production.degraded}, rotations ${c.rotations.degraded}. Label accuracies are weighted (see below).</p>
    <h3>Verdict moves</h3>
    ${moves}
  </section>`
}

function scoreTable(s: ReadingScore): string {
  const rows = s.confusionRows
  return `<table class="confusion"><thead><tr><th class="corner">verdict ↓ · your label →</th>${VERDICTS.map(v => `<th>${v}</th>`).join('')}</tr></thead><tbody>${
    rows.map((r, i) => s.confusion[i].some(v => v > 0) || i < VERDICTS.length
      ? `<tr><th>${r}</th>${VERDICTS.map((v, j) => `<td class="${r === v ? 'diag' : ''}" style="--a:${(s.confusion[i][j] / Math.max(1, ...s.confusion.flat())).toFixed(3)}">${s.confusion[i][j] || ''}</td>`).join('')}</tr>` : '').join('')
  }</tbody></table>`
}

function sweepSeries(sweep: LabelSweepPoint[], withRot: boolean): ChartSeries[] {
  const y = (r: WRate) => r.n ? r.hit / r.n : null
  const out: ChartSeries[] = [
    { name: 'production: coverage', cls: 's1', points: sweep.map(pt => ({ x: pt.theta, y: y(pt.production.coverage) })) },
    { name: 'production: accuracy, abstention', cls: 's2', points: sweep.map(pt => ({ x: pt.theta, y: y(pt.production.abstention) })) },
    { name: 'production: accuracy, as in production', cls: 's3', points: sweep.map(pt => ({ x: pt.theta, y: y(pt.production.asProduction) })) },
  ]
  if (withRot) {
    out.push(
      { name: 'rotations: coverage', cls: 's4', points: sweep.map(pt => ({ x: pt.theta, y: pt.rotations ? y(pt.rotations.coverage) : null })) },
      { name: 'rotations: accuracy, abstention', cls: 's5', points: sweep.map(pt => ({ x: pt.theta, y: pt.rotations ? y(pt.rotations.abstention) : null })) },
      { name: 'rotations: accuracy, as in production', cls: 's6', points: sweep.map(pt => ({ x: pt.theta, y: pt.rotations ? y(pt.rotations.asProduction) : null })) },
    )
  }
  return out
}

function labelsSection(a: ImportanceAnalysis, thetas: number[], lineChart: LineChart): string {
  const L = a.labels
  const total = a.labeling.items.length
  const head = `<h2 id="imp-labels">Importance against your blind labels</h2>
    <p><a href="#labeling" target="_blank" rel="noopener">Open the blind labeling page</a> (${total} articles). ${L.labeled} labeled, ${L.unsure} “I don’t know”, ${L.pending} not labeled yet.</p>`
  if (!L.labeled) {
    return `<section>${head}<p class="muted">No label imported yet. Label the articles, export the JSON, then set <code>labelsFile</code> in scripts/notjev-bench.config.json (with <code>runDir</code> set to this run) and run the bench again: the report is recomputed without any call.</p></section>`
  }
  const weights = `<table class="kv"><thead><tr><th>notjev verdict (stratum)</th><th>articles in the sample</th><th>drawn</th><th>labeled</th><th>“I don’t know”</th><th>weight per labeled article</th></tr></thead><tbody>${
    L.weights.map(x => `<tr><th>${x.stratum}</th><td>${x.size}</td><td>${x.drawn}</td><td>${x.labeled}</td><td>${x.unsure}</td><td>${x.labeled ? x.weight.toFixed(2) : '–'}</td></tr>`).join('')
  }</tbody></table>`
  const rotRow = L.rotations ? `<tr><th>notjev, by rotations</th><td>${w(L.rotations.abstention)}</td><td>${w(L.rotations.coverage)}</td><td>${w(L.rotations.asProduction)}</td></tr>` : ''
  return `
  <section>
    ${head}
    <p class="muted"><b>Weighted figures.</b> The labeling draw is stratified on notjev's production verdict (${a.labeling.drawn.ESSENTIAL} ESSENTIAL, ${a.labeling.drawn.USEFUL} USEFUL, ${a.labeling.drawn.SKIP} SKIP, ${a.labeling.drawn.UNDECIDED} undecided), not proportional, so each labeled article counts for the size of its stratum in the ${STRATA.reduce((n, s) => n + a.labeling.strataSizes[s], 0)}-article sample divided by the labels of that stratum. “I don’t know” is left out, as if missing at random within its stratum. The sample itself puts labeled articles (votes, likes, bookmarks) first, so these figures describe the sample, not your whole database. Counts in brackets are raw articles.${a.labeling.excludedAsExamples ? ` ${a.labeling.excludedAsExamples} article(s) left out because their title is an example in their importance question.` : ''}</p>
    ${L.uncoveredStrata.length ? `<p class="bad">No usable label in stratum ${L.uncoveredStrata.join(', ')}: the weighted figures leave it out.</p>` : ''}
    ${weights}
    <h3>Accuracy</h3>
    <div class="scroll"><table class="kv"><thead><tr><th></th><th>accuracy, abstention (decided only)</th><th>coverage (decided)</th><th>accuracy as in production (undecided = USEFUL)</th></tr></thead><tbody>
      <tr><th>notjev, production order</th><td>${w(L.production.abstention)}</td><td>${w(L.production.coverage)}</td><td>${w(L.production.asProduction)}</td></tr>
      ${rotRow}
      <tr><th>reasoned reference</th><td>${w(L.reference.abstention)}</td><td>${w(L.reference.coverage)} <span class="muted">readable</span></td><td class="muted">–</td></tr>
      <tr><th>null arm: always ${esc(L.nullArm.label)}</th><td>${w(L.nullArm.rate)}</td><td class="muted">100 %</td><td>${w(L.nullArm.rate)}</td></tr>
    </tbody></table></div>
    <p class="muted">The journal reads an undecided importance as USEFUL (shared/classification.ts), hence the “as in production” column.</p>
    <h3>Confusion against your labels <span class="muted">(raw counts)</span></h3>
    <div class="tables">
      <div><h4>notjev, production order</h4><div class="scroll">${scoreTable(L.production)}</div></div>
      ${L.rotations ? `<div><h4>notjev, by rotations</h4><div class="scroll">${scoreTable(L.rotations)}</div></div>` : ''}
      <div><h4>reasoned reference</h4><div class="scroll">${scoreTable(L.reference)}</div></div>
    </div>
    <h3>Accuracy of the top answer by band <span class="muted">(weighted)</span></h3>
    <table class="kv"><thead><tr><th>band (p1)</th><th>production order</th>${L.rotations ? '<th>by rotations</th>' : ''}</tr></thead><tbody>
      ${L.bands.map(b => `<tr><th>${b.band}</th><td>${w(b.production)}</td>${L.rotations ? `<td>${w(b.rotations)}</td>` : ''}</tr>`).join('')}
    </tbody></table>
    <h3>Theta curve against your labels <span class="muted">(weighted, offline)</span></h3>
    ${lineChart(sweepSeries(L.sweep, !!L.rotations), a.theta, thetas)}
  </section>`
}

function reproSection(a: ImportanceAnalysis): string {
  const r = a.repro
  const n = r.rows.length
  const share = (k: number) => n ? `${(100 * k / n).toFixed(0)} %` : '–'
  const yes = (b: boolean) => b ? '<b>yes</b>' : '<span class="muted">no</span>'
  return `
  <section id="imp-repro">
    <h2>Importance reproducibility diagnosis</h2>
    <div class="cards">
      <div class="card"><div class="big">${n}/${r.compared}</div><div>importance differs from <code>articles.importance</code></div></div>
      <div class="card"><div class="big">${share(r.byCause.context)}</div><div>of the gaps explained by a context change (${r.byCause.context})</div></div>
      <div class="card accent"><div class="big">${share(r.byCause.unexplained)}</div><div>unexplained (${r.byCause.unexplained})</div></div>
      <div class="card"><div class="big">${share(r.byCause['not-asked'])}</div><div>classified before importance existed (${r.byCause['not-asked']})</div></div>
    </div>
    <p class="muted">Context change: after <code>classified_at</code>, the instruction of the stored theme was edited (<code>journal_instructions.updated_at</code>), or votes were cast on that theme (<code>journal_feedback.created_at</code>), or the theme read today differs from the stored one (the importance question then carries another theme's context). Limits: the snapshot keeps only the last edit of an instruction and does not see deleted votes, so some “unexplained” gaps may still be context changes. “Before importance”: classified before migration 0022 (${esc(r.importanceSince ?? 'date unknown')}), stored NULL means never asked.</p>
    ${n ? `<details open><summary>${n} article(s)</summary><div class="scroll"><table class="kv"><thead><tr><th>article</th><th>stored</th><th>re-read, production order</th><th>re-read, shuffled</th><th>by rotations</th><th>theme stored → now</th><th>instruction edited after</th><th>votes after</th><th>cause</th></tr></thead><tbody>${
      r.rows.map(x => `<tr><td>#${x.articleId} ${esc(x.title)}</td><td>${esc(x.stored)}</td><td>${esc(x.production)}</td><td>${esc(x.shuffled)}</td><td>${esc(x.rotations)}</td><td>${esc(x.themeStored)} → ${esc(x.themeNow)}${x.themeChanged ? ' <b>≠</b>' : ''}</td><td>${yes(x.instructionChanged)}</td><td>${x.votesAfter || '<span class="muted">0</span>'}</td><td>${esc(x.cause)}</td></tr>`).join('')
    }</tbody></table></div></details>` : ''}
  </section>`
}

/** Sections shown in the report body, after the per-question sections */
export function importanceSections(a: ImportanceAnalysis | null, thetas: number[], lineChart: LineChart): string {
  if (!a) return ''
  return rotationsSection(a) + labelsSection(a, thetas, lineChart) + reproSection(a)
}

/**
 * The blind labeling page: a separate view of the same file (#labeling) that
 * hides the rest of the report. Its data carries no verdict, no stratum and
 * no reference answer, only what the model read.
 */
export function labelingView(): string {
  return `
<div id="labeling-view" hidden>
  <h1>Blind importance labeling</h1>
  <p class="muted">For each article, how important is it for you? Nothing here shows what notjev or the reference answered. Your choices stay in this browser until you export them; then set <code>labelsFile</code> in scripts/notjev-bench.config.json (with <code>runDir</code> set to this run) and run the bench again: the report is recomputed without any call.</p>
  <div class="toolbar">
    <span id="lab-count" class="muted"></span>
    <select id="lab-show"><option value="">all</option><option value="todo">not labeled</option><option value="done">labeled</option></select>
    <button id="lab-export">Export labels (JSON)</button>
    <button id="lab-reset">Clear my labels</button>
    <a href="#" id="lab-back">Back to the report</a>
  </div>
  <div id="lab-list"></div>
</div>`
}

export function labelingData(a: ImportanceAnalysis | null, imported: Record<string, string>): { items: Array<Record<string, unknown>>; labels: Record<string, string> } {
  return {
    items: (a?.labeling.items ?? []).map(i => ({ id: i.articleId, title: i.title, feed: i.feed, url: i.url, state: i.state })),
    labels: imported,
  }
}

export const LABELING_CSS = `
.lab{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:12px;margin:10px 0}.lab .title{font-weight:600}
.lab pre{white-space:pre-wrap;word-break:break-word;font:13px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:8px;max-height:260px;overflow:auto;margin:8px 0}
.lab .btns{display:flex;flex-wrap:wrap;gap:6px}.lab.done{border-color:var(--good)}
.bad{color:var(--bad)}
.tables{display:flex;flex-wrap:wrap;gap:20px}.tables>div{min-width:0;max-width:100%}
path.s5,path.s6{stroke-width:2}path.s5{stroke:var(--s5);stroke-dasharray:5 3}path.s6{stroke:var(--s6);stroke-dasharray:5 3}circle.s5{fill:var(--s5)}circle.s6{fill:var(--s6)}.legend i.s5{background:var(--s5)}.legend i.s6{background:var(--s6)}
`

export const LABELING_JS = `
(function(){
  var L = JSON.parse(document.getElementById('labeling-data').textContent);
  var KEY = 'notjev-bench-labels:' + L.run;
  var labels = Object.assign({}, L.labels || {});
  try { var saved = localStorage.getItem(KEY); if (saved) labels = JSON.parse(saved) || labels; } catch (e) {}
  function save(){ try { localStorage.setItem(KEY, JSON.stringify(labels)); } catch (e) {} }
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  var CHOICES = [['ESSENTIAL','ESSENTIAL'],['USEFUL','USEFUL'],['SKIP','SKIP'],['unsure','I don\\u2019t know']];
  function render(){
    var sh = document.getElementById('lab-show').value;
    var done = L.items.filter(function(i){ return labels[i.id]; }).length;
    document.getElementById('lab-count').textContent = done + ' / ' + L.items.length + ' labeled';
    document.getElementById('lab-list').innerHTML = L.items.filter(function(i){
      return !sh || (sh === 'done') === !!labels[i.id];
    }).map(function(i, n){
      return '<div class="lab' + (labels[i.id] ? ' done' : '') + '" data-id="' + i.id + '"><div><span class="muted">' + (L.items.indexOf(i) + 1) + '.</span> <a class="title" href="' + esc(i.url) + '" target="_blank" rel="noopener">' + esc(i.title) + '</a> <span class="muted">· ' + esc(i.feed || '') + '</span></div>'
        + '<pre>' + esc(i.state) + '</pre>'
        + '<div class="btns">' + CHOICES.map(function(c){ return '<button data-v="' + c[0] + '" class="' + (labels[i.id] === c[0] ? 'on' : '') + '">' + c[1] + '</button>'; }).join('') + '</div></div>';
    }).join('') || '<p class="muted">Nothing to show.</p>';
  }
  document.getElementById('lab-list').addEventListener('click', function(e){
    var b = e.target.closest('button[data-v]'); if (!b) return;
    var id = b.closest('.lab').getAttribute('data-id'), v = b.getAttribute('data-v');
    if (labels[id] === v) delete labels[id]; else labels[id] = v;
    save(); render();
  });
  document.getElementById('lab-show').addEventListener('change', render);
  document.getElementById('lab-export').addEventListener('click', function(){
    var blob = new Blob([JSON.stringify({ version: 1, run: L.run, items: labels }, null, 1)], { type: 'application/json' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'labels-' + L.run + '.json';
    document.body.appendChild(a); a.click(); a.remove();
  });
  document.getElementById('lab-reset').addEventListener('click', function(){
    if (!confirm('Clear every label kept in this browser for this run?')) return;
    labels = {}; save(); render();
  });
  document.getElementById('lab-back').addEventListener('click', function(e){ e.preventDefault(); location.hash = ''; });
  // The labeling view hides the whole report, so no verdict is in sight while labeling
  function route(){
    var on = location.hash === '#labeling';
    document.getElementById('labeling-view').hidden = !on;
    document.getElementById('report-view').hidden = on;
    if (on) { render(); window.scrollTo(0, 0); }
  }
  window.addEventListener('hashchange', route);
  route();
})();
`
