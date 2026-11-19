/**
 * Audit a journal edition: important articles left out, and citations that
 * do not match their article. Read-only, safe while the server runs.
 *
 *   npm run audit:journal                 latest finished edition
 *   npm run audit:journal -- 12           edition 12
 *   npm run audit:journal -- 12 --out report.md
 */
import fs from 'node:fs'
import { getEdition, listEditions } from '../server/intelligence/journal-db.js'
import { getAuditArticles, getOutOfScopeArticles } from '../server/intelligence/journal-audit-db.js'
import { auditEdition, formatAuditReport } from '../server/intelligence/journal-audit.js'

function main() {
  const args = process.argv.slice(2)
  const outIndex = args.indexOf('--out')
  const out = outIndex >= 0 ? args[outIndex + 1] : undefined
  const idArg = args.find((a, i) => /^\d+$/.test(a) && i !== outIndex + 1)

  const id = idArg ? Number(idArg) : listEditions(1)[0]?.id
  if (id === undefined) {
    console.error('No finished edition.')
    process.exit(1)
  }
  const edition = getEdition(id)
  if (!edition?.content) {
    console.error(`Edition ${id} not found or has no content (status: ${edition?.status ?? 'missing'}).`)
    process.exit(1)
  }

  const coveredIds = edition.content.sections.flatMap(s => s.article_ids)
  const audit = auditEdition({
    editionId: id,
    content: edition.content,
    articles: getAuditArticles(coveredIds),
    outOfScope: getOutOfScopeArticles(edition.period_start, edition.period_end, coveredIds),
  })
  const report = formatAuditReport(audit)
  if (out) {
    fs.writeFileSync(out, report)
    console.log(`Report written to ${out}`)
  } else {
    process.stdout.write(report)
  }
}

main()
