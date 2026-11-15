import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setupTestDb } from '../../__tests__/helpers/testDb.js'
import { buildApp } from '../../__tests__/helpers/buildApp.js'
import { lockPath } from './lock.js'
import type { FastifyInstance } from 'fastify'

let app: FastifyInstance
let dir: string
const json = { 'content-type': 'application/json' }

beforeEach(async () => {
  setupTestDb()
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notjev-routes-'))
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ outputDir: dir }))
  process.env.NOTJEV_BENCH_CONFIG = path.join(dir, 'config.json')
  app = await buildApp()
})

afterEach(() => {
  delete process.env.NOTJEV_BENCH_CONFIG
  process.env.AUTH_DISABLED = '1'
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('bench routes', () => {
  it('answer 401 without authentication', async () => {
    process.env.AUTH_DISABLED = '0'
    for (const [method, url] of [
      ['GET', '/api/classification/bench'],
      ['POST', '/api/classification/bench/start'],
      ['POST', '/api/classification/bench/stop'],
      ['POST', '/api/classification/bench/runs/notjev-bench-2026-11-01T00-00-00-000Z/resume'],
      ['POST', '/api/classification/bench/runs/notjev-bench-2026-11-01T00-00-00-000Z/arbitrations'],
      ['GET', '/api/classification/bench/runs/notjev-bench-2026-11-01T00-00-00-000Z/report'],
    ] as const) {
      const res = await app.inject({ method, url, headers: json, payload: method === 'POST' ? {} : undefined })
      expect(res.statusCode, `${method} ${url}`).toBe(401)
    }
  })

  it('refuse a start while another run holds the lock (e.g. from the command line)', async () => {
    fs.writeFileSync(lockPath(dir), JSON.stringify({ pid: process.pid, runDir: path.join(dir, 'notjev-bench-2026-11-01T00-00-00-000Z'), startedAt: '' }))
    const res = await app.inject({ method: 'POST', url: '/api/classification/bench/start', headers: json, payload: { trial: true } })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toContain('notjev-bench-2026-11-01T00-00-00-000Z')
    const list = await app.inject({ method: 'GET', url: '/api/classification/bench' })
    expect(list.json().running).toBe('notjev-bench-2026-11-01T00-00-00-000Z')
    // No run folder was created by the refused start
    expect(fs.readdirSync(dir).filter(n => n.startsWith('notjev-bench-'))).toEqual([])
  })
})
