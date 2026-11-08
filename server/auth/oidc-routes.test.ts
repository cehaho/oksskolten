import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Fastify from 'fastify'
import jwt from '@fastify/jwt'
import rateLimit from '@fastify/rate-limit'
import type { FastifyInstance } from 'fastify'
import { setupTestDb } from '../__tests__/helpers/testDb.js'
import { getDb, upsertSetting } from '../db.js'
import { hashSync } from 'bcryptjs'
import { oidcRoutes, isOidcEnabled, clearOidcDiscoveryCache } from './oidc-routes.js'
import { oauthRoutes } from './oauth-routes.js'
import { authRoutes } from './routes.js'
import { passkeyRoutes } from './passkey-routes.js'

const ISSUER = 'https://id.example.com'
const json = { 'content-type': 'application/json' }

let app: FastifyInstance
let savedAuthDisabled: string | undefined
let userinfo: Record<string, unknown>

function seedUser(email = 'test@example.com') {
  getDb().prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run(email, hashSync('password123', 4))
}

function configureOidc(allowed = 'me@example.com') {
  upsertSetting('auth.oidc_issuer', ISSUER)
  upsertSetting('auth.oidc_client_id', 'client-id')
  upsertSetting('auth.oidc_client_secret', 'client-secret')
  upsertSetting('auth.oidc_allowed_users', allowed)
}

function enableOidc(allowed?: string) {
  configureOidc(allowed)
  upsertSetting('auth.oidc_enabled', '1')
}

function authHeader() {
  const user = getDb().prepare('SELECT email, token_version FROM users LIMIT 1').get() as { email: string; token_version: number }
  return { authorization: `Bearer ${app.jwt.sign({ email: user.email, token_version: user.token_version })}` }
}

function mockProvider() {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (url === `${ISSUER}/.well-known/openid-configuration`) {
      return Response.json({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/authorize`,
        token_endpoint: `${ISSUER}/api/oidc/token`,
        userinfo_endpoint: `${ISSUER}/api/oidc/userinfo`,
      })
    }
    if (url === `${ISSUER}/api/oidc/token`) {
      return Response.json({ access_token: 'at', token_type: 'Bearer', expires_in: 3600 })
    }
    if (url === `${ISSUER}/api/oidc/userinfo`) {
      return Response.json(userinfo)
    }
    return new Response('not found', { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

async function buildApp() {
  const app = Fastify()
  await app.register(jwt, { secret: 'test-secret', sign: { expiresIn: '30d' } })
  await app.register(rateLimit, { max: 100, timeWindow: '1 minute' })
  await app.register(authRoutes)
  await app.register(passkeyRoutes)
  await app.register(oauthRoutes)
  await app.register(oidcRoutes)
  return app
}

async function startLogin(): Promise<string> {
  const res = await app.inject({
    method: 'POST', url: '/api/oauth/oidc/authorize', headers: json,
    payload: { origin: 'http://localhost:3000' },
  })
  expect(res.statusCode).toBe(200)
  return new URL(res.json().url).searchParams.get('state')!
}

beforeEach(async () => {
  setupTestDb()
  clearOidcDiscoveryCache()
  app = await buildApp()
  savedAuthDisabled = process.env.AUTH_DISABLED
  delete process.env.AUTH_DISABLED
  userinfo = { sub: 'abc-123', email: 'me@example.com', email_verified: true, preferred_username: 'me' }
})

afterEach(() => {
  vi.unstubAllGlobals()
  if (savedAuthDisabled !== undefined) process.env.AUTH_DISABLED = savedAuthDisabled
  else delete process.env.AUTH_DISABLED
})

describe('isOidcEnabled', () => {
  it('is false when not configured', () => {
    upsertSetting('auth.oidc_enabled', '1')
    expect(isOidcEnabled()).toBe(false)
  })

  it('is false without allowed users', () => {
    enableOidc('')
    expect(isOidcEnabled()).toBe(false)
  })

  it('is true when configured and enabled', () => {
    enableOidc()
    expect(isOidcEnabled()).toBe(true)
  })
})

describe('GET /api/auth/methods', () => {
  it('reports OIDC state and display name', async () => {
    enableOidc()
    upsertSetting('auth.oidc_display_name', 'My SSO')
    const res = await app.inject({ method: 'GET', url: '/api/auth/methods' })
    expect(res.json().oidc).toEqual({ enabled: true, name: 'My SSO' })
  })
})

describe('POST /api/oauth/oidc/authorize', () => {
  it('returns 400 when not enabled', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/oauth/oidc/authorize', headers: json, payload: {} })
    expect(res.statusCode).toBe(400)
  })

  it('returns a PKCE authorization URL from discovery', async () => {
    enableOidc()
    mockProvider()
    const res = await app.inject({
      method: 'POST', url: '/api/oauth/oidc/authorize', headers: json,
      payload: { origin: 'http://localhost:3000' },
    })
    expect(res.statusCode).toBe(200)
    const url = new URL(res.json().url)
    expect(url.origin + url.pathname).toBe(`${ISSUER}/authorize`)
    expect(url.searchParams.get('client_id')).toBe('client-id')
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:3000/api/oauth/oidc/callback')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('scope')).toBe('openid email profile')
    expect(url.searchParams.get('state')).toBeTruthy()
  })

  it('returns 502 when discovery fails', async () => {
    enableOidc()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 500 })))
    const res = await app.inject({ method: 'POST', url: '/api/oauth/oidc/authorize', headers: json, payload: {} })
    expect(res.statusCode).toBe(502)
  })
})

describe('GET /api/oauth/oidc/callback', () => {
  it('rejects an unknown state', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/oauth/oidc/callback?code=x&state=nope' })
    expect(res.headers.location).toBe('/?oauth_error=invalid_state')
  })

  it('logs in an allowed user and the code exchanges for a JWT', async () => {
    seedUser()
    enableOidc()
    mockProvider()
    const state = await startLogin()

    const res = await app.inject({ method: 'GET', url: `/api/oauth/oidc/callback?code=c&state=${state}` })
    expect(res.statusCode).toBe(302)
    const code = new URL(res.headers.location as string, 'http://x').searchParams.get('oauth_code')
    expect(code).toBeTruthy()

    const tokenRes = await app.inject({
      method: 'POST', url: '/api/oauth/github/token', headers: json, payload: { code },
    })
    expect(tokenRes.statusCode).toBe(200)
    expect(tokenRes.json().token).toBeTruthy()
  })

  it('matches on preferred_username or sub', async () => {
    seedUser()
    enableOidc('abc-123')
    mockProvider()
    const state = await startLogin()
    const res = await app.inject({ method: 'GET', url: `/api/oauth/oidc/callback?code=c&state=${state}` })
    expect(res.headers.location).toMatch(/^\/\?oauth_code=/)
  })

  it('rejects a user not in the allow list', async () => {
    seedUser()
    enableOidc('someone-else@example.com')
    mockProvider()
    const state = await startLogin()
    const res = await app.inject({ method: 'GET', url: `/api/oauth/oidc/callback?code=c&state=${state}` })
    expect(res.headers.location).toBe('/?oauth_error=unauthorized')
  })

  it('ignores an unverified email', async () => {
    seedUser()
    enableOidc('me@example.com')
    userinfo = { sub: 'abc-123', email: 'me@example.com', email_verified: false }
    mockProvider()
    const state = await startLogin()
    const res = await app.inject({ method: 'GET', url: `/api/oauth/oidc/callback?code=c&state=${state}` })
    expect(res.headers.location).toBe('/?oauth_error=unauthorized')
  })

  it('state is single-use', async () => {
    seedUser()
    enableOidc()
    mockProvider()
    const state = await startLogin()
    await app.inject({ method: 'GET', url: `/api/oauth/oidc/callback?code=c&state=${state}` })
    const res = await app.inject({ method: 'GET', url: `/api/oauth/oidc/callback?code=c&state=${state}` })
    expect(res.headers.location).toBe('/?oauth_error=invalid_state')
  })
})

describe('OIDC config and toggle', () => {
  it('requires auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/oauth/oidc/config' })
    expect(res.statusCode).toBe(401)
  })

  it('saves config without returning the secret', async () => {
    seedUser()
    const res = await app.inject({
      method: 'POST', url: '/api/oauth/oidc/config', headers: { ...json, ...authHeader() },
      payload: { issuer: `${ISSUER}/`, clientId: 'cid', clientSecret: 'sec', allowedUsers: 'me@example.com' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.issuer).toBe(ISSUER)
    expect(body.configured).toBe(true)
    expect(body.hasClientSecret).toBe(true)
    expect(JSON.stringify(body)).not.toContain('sec"')
  })

  it('rejects a non-http issuer', async () => {
    seedUser()
    const res = await app.inject({
      method: 'POST', url: '/api/oauth/oidc/config', headers: { ...json, ...authHeader() },
      payload: { issuer: 'javascript:alert(1)' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('refuses to enable when not configured', async () => {
    seedUser()
    const res = await app.inject({
      method: 'POST', url: '/api/oauth/oidc/toggle', headers: { ...json, ...authHeader() },
      payload: { enabled: true },
    })
    expect(res.statusCode).toBe(400)
  })

  it('prevents disabling when it is the only login method', async () => {
    seedUser()
    enableOidc()
    upsertSetting('auth.password_enabled', '0')
    const res = await app.inject({
      method: 'POST', url: '/api/oauth/oidc/toggle', headers: { ...json, ...authHeader() },
      payload: { enabled: false },
    })
    expect(res.statusCode).toBe(400)
  })

  it('prevents clearing the allow list when it is the only login method', async () => {
    seedUser()
    enableOidc()
    upsertSetting('auth.password_enabled', '0')
    const res = await app.inject({
      method: 'POST', url: '/api/oauth/oidc/config', headers: { ...json, ...authHeader() },
      payload: { allowedUsers: ' , ' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('counts as an alternative when disabling password auth', async () => {
    seedUser()
    enableOidc()
    const res = await app.inject({
      method: 'POST', url: '/api/auth/password/toggle', headers: { ...json, ...authHeader() },
      payload: { enabled: false },
    })
    expect(res.statusCode).toBe(200)
  })
})
