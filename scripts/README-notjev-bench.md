# notjev accuracy bench

Measures how right the three classification decisions (format, theme, importance) are on your own articles. Code: `server/bench/notjev/`. Spec: `docs/spec/87_feature_classification.md`.

## Guarantees

- **Read-only on production.** The production database is opened once, read-only, to copy it with `VACUUM INTO` into `data/notjev-bench-<ISO>/snapshot.db`; every later read goes to that copy. `run.ts` imports nothing that opens the database before it points `DATABASE_URL` at the copy (checked by `run.test.ts`), and the pipeline refuses to start on any other database. Model, server URL, API key, thresholds and themes are read from the copy, as production reads them.
- **One run at a time.** `run.ts` takes a lock file (`notjev-bench.lock` in the output folder) before anything else. A second start, from the panel or the command line, is refused while it is held; a lock left by a dead process is taken over.
- **Authenticated.** The panel's routes (`/api/classification/bench/*`) sit in the authenticated API scope, like every settings route.

## Run it

From the app: Settings → Integration → Article classification → Accuracy bench → **Trial run** (20 articles) or **Full run** (300). The panel shows progress, can stop or resume a run, and opens the report.

From a terminal, with the settings of `scripts/notjev-bench.config.json`:

```bash
npm run bench:notjev
```

The shipped config has `"trial": true` for a first pass; set it to `false` for the full sample. Other keys: `sampleSize`, `trialSize`, `seed`, `concurrency` (1 by default: the inference server is shared), `sourceDb` and `outputDir` (empty = the server's own database and data folder), `replayFile`, `thetas`, `reasoning` (max tokens, timeout, temperature and instruction of the reasoned reference), `rotations` (on by default, see below), `labeling` (`size` 60, `perStratum` 15), `arbitrationsFile` and `labelsFile`.

### Cost and duration

11 calls per article: 3 one-token readouts, 3 with options permuted, 2 importance rotations, 3 reasoned. The trial run took 18 min for 20 articles (notjev about 0.6 s per call, reasoned reference 5 to 27 s on average depending on the question), so count **about 4 h 30 for 300 new articles**, plus about 1 s per article for the rotations. On a run already done before rotations existed, resuming it only makes the 2 rotation calls per article: about 5 min for 300 articles.

## Resume a run

Every answer is appended to `results.jsonl` as it arrives, under a key `article|reading|question`. To finish an interrupted run, press **Resume** in the panel, or set `"runDir"` to its folder (e.g. `"data/notjev-bench-2026-11-03T10-20-30-000Z"`) and run the command again: recorded calls are skipped, new readings (the rotations) are the only calls made. Leave `arbitrationsFile` and `labelsFile` empty when resuming (either one makes the run report-only); the arbitrations and labels already imported into the run are read again from its folder.

## Importance by rotations

A candidate fix for the position bias, **measured only** (`server/ai/classify.ts` is not changed): the importance question is also asked with its options in the two other rotations (USEFUL/SKIP/ESSENTIAL and SKIP/ESSENTIAL/USEFUL; the production order is the first rotation and reuses the production call). Each distribution is read back onto the option ids, the three are averaged, and the production margin rule is applied (theta 0.3). The report compares it with the production reading: agreement with the reference, accuracy against your labels, share undecided, verdict distribution and verdict moves. Set `"rotations": false` to skip the 2 extra calls.

## Label importance blind

1. Open `report.html` and follow **open the labeling page** (or add `#labeling` to its address). The page hides the rest of the report and shows neither notjev's nor the reference's answers. Do it before reading the per-article lists of the report, which show verdicts.
2. 60 articles, drawn with the run's seed, stratified on notjev's production verdict (15 ESSENTIAL, 15 USEFUL, 15 SKIP, 15 undecided, completed from the other strata when one runs short), shown in a shuffled order. Articles whose title is an example in their own importance question are left out. Each card shows the title, source, link and the exact text sent to the model; answer ESSENTIAL, USEFUL, SKIP or *I don't know*. Choices stay in your browser, with a progress counter.
3. Click **Export labels (JSON)**, then either press **Import labels** next to the run in the panel and pick the file (the way to go with the Docker image, which ships no `scripts/` folder), or set in the config:

   ```json
   "runDir": "data/notjev-bench-<ISO>",
   "labelsFile": "path/to/labels-notjev-bench-<ISO>.json"
   ```

   and run `npm run bench:notjev`. No call is made: the report is recomputed. Empty `labelsFile` again afterwards (the file is kept in the run folder as `labels.json`).

The report then gives, for notjev in production order, notjev by rotations, the reasoned reference and a null arm (always the most frequent label): accuracy with abstention (decided verdicts only, with the coverage) and accuracy **as in production** (an undecided verdict counts as USEFUL, as the journal applies it), confusion matrices against your labels, accuracy by band and the theta curve. Because the draw is stratified, figures are **weighted** by the size of each stratum in the sample (each labeled article counts for stratum size / labels in that stratum); *I don't know* is left out. The sample puts articles with votes, likes or bookmarks first, so the figures describe the sample, not the whole database.

## Importance reproducibility diagnosis

For every article whose importance read today differs from `articles.importance`, the report lists the stored value, the re-read in production order, the re-read with options shuffled, the reading by rotations, the stored and current theme, and whether the stored theme's journal instruction was edited (`journal_instructions.updated_at`) or votes were cast on it (`journal_feedback.created_at`) after `classified_at`. The header splits the gaps into explained by a context change, unexplained, and classified before importance existed (migration 0022, stored NULL = never asked). The snapshot only keeps the last edit of an instruction and no deleted vote, so some unexplained gaps may still be context changes.

## Re-inject your arbitrations

1. Open `report.html`, go to the disagreement list and mark each one: *notjev is right*, *reference is right* or *neither*. Choices stay in your browser.
2. Click **Export arbitrations (JSON)**.
3. Either press **Import arbitrations** next to the run in the panel and pick the file, or set in the config:

   ```json
   "runDir": "data/notjev-bench-<ISO>",
   "arbitrationsFile": "path/to/arbitrations-notjev-bench-<ISO>.json"
   ```

   and run `npm run bench:notjev`. With `arbitrationsFile` set, no call is made: the report is recomputed from the recorded answers and shows accuracy after arbitration. Empty `arbitrationsFile` again afterwards.

## Files of a run

| File | Content |
|---|---|
| `snapshot.db` | Consistent copy of the database |
| `sample.json` | Articles, labels, settings read |
| `results.jsonl` | One line per call: request, full response, probabilities, p1, margin, band, coverage, degraded, time |
| `report.html` | The report and the blind labeling page (`#labeling`), self-contained |
| `replay.json` | Recording for `npx notjev replay replay.json --truth gold` (gold = reasoned reference) |
| `arbitrations.json` | Last imported arbitrations |
| `labels.json` | Last imported importance labels |
| `progress.json`, `bench.log` | Progress and log of a run started from the app |
