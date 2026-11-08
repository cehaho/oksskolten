import crypto from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { GitHub, generateState } from 'arctic'
import { getDb, getSetting, upsertSetting } from '../db.js'
import { requireAuth, getOrigin } from './guards.js'
import { exchangeCodes, isGitHubOAuthEnabled, hasOtherLoginMethod } from './sso.js'

export { isGitHubOAuthEnabled }
import { TtlStore } from '../lib/ttl-store.js'
import { parseOrBadRequest } from '../lib/validation.js'

const AuthorizeBody = z.object({
  origin: z.string().optional(),
})

const CallbackQuery = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
})

const TokenBody = z.object({
  code: z.string({ error: 'Missing code' }).min(1, 'Missing code'),
})

const GithubConfigBody = z.object({
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  allowedUsers: z.string().optional(),
})

const GithubToggleBody = z.object({
  enabled: z.boolean(),
})

// --- In-memory stores ---

const STATE_TTL = 300_000 // 5 min

const oauthStates = new TtlStore<{ redirectURI: string }>(STATE_TTL)

// --- Helpers ---

function createGitHubClient(redirectURI?: string | null): GitHub | null {
  const clientId = getSetting('auth.github_client_id')
  const clientSecret = getSetting('auth.github_client_secret')
  if (!clientId || !clientSecret) return null
  return new GitHub(clientId, clientSecret, redirectURI ?? null)
}

// --- Routes ---

export async function oauthRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store')
  })

  // POST /api/oauth/github/authorize — public
  // Frontend sends { origin } so we build the correct callback URL
  // regardless of proxy configuration
  app.post('/api/oauth/github/authorize', async (request, reply) => {
    if (!isGitHubOAuthEnabled()) {
      return reply.status(400).send({ error: 'GitHub OAuth is not enabled' })
    }

    const body = parseOrBadRequest(AuthorizeBody, request.body, reply)
    if (!body) return
    const origin = body.origin || getOrigin(request)
    const redirectURI = `${origin}/api/oauth/github/callback`
    const github = createGitHubClient(redirectURI)
    if (!github) {
      return reply.status(400).send({ error: 'GitHub OAuth is not configured' })
    }

    const state = generateState()
    oauthStates.set(state, { redirectURI })

    const url = github.createAuthorizationURL(state, ['read:user'])
    reply.send({ url: url.toString() })
  })

  // GET /api/oauth/github/callback — public, rate-limited
  app.get('/api/oauth/github/callback', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { code, state } = CallbackQuery.parse(request.query)

    // Validate state (consume atomically — single-use)
    const stateEntry = state ? oauthStates.consume(state) : null
    if (!stateEntry) {
      return reply.redirect('/?oauth_error=invalid_state')
    }

    if (!code) {
      return reply.redirect('/?oauth_error=missing_code')
    }

    // Reuse the redirect URI from the authorize step to ensure it matches
    const github = createGitHubClient(stateEntry.redirectURI)
    if (!github) {
      return reply.redirect('/?oauth_error=not_configured')
    }

    try {
      const tokens = await github.validateAuthorizationCode(code)
      const accessToken = tokens.accessToken()

      // Fetch GitHub user info
      const userRes = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'User-Agent': 'Reader-RSS',
        },
      })
      if (!userRes.ok) {
        return reply.redirect('/?oauth_error=github_api_error')
      }
      const ghUser = await userRes.json() as { login: string }

      // Check allowed users
      const allowedRaw = getSetting('auth.github_allowed_users') || ''
      const allowedUsers = allowedRaw.split(',').map(u => u.trim().toLowerCase()).filter(Boolean)

      if (allowedUsers.length > 0) {
        // Explicit allow list
        if (!allowedUsers.includes(ghUser.login.toLowerCase())) {
          return reply.redirect('/?oauth_error=unauthorized')
        }
      } else {
        // No allow list — only permit the OAuth App owner
        const clientId = getSetting('auth.github_client_id')!
        const clientSecret = getSetting('auth.github_client_secret')!
        const appRes = await fetch(`https://api.github.com/applications/${clientId}`, {
          headers: {
            Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
            'User-Agent': 'Reader-RSS',
          },
        })
        if (!appRes.ok) {
          return reply.redirect('/?oauth_error=github_api_error')
        }
        const appInfo = await appRes.json() as { owner: { login: string } }
        if (ghUser.login.toLowerCase() !== appInfo.owner.login.toLowerCase()) {
          return reply.redirect('/?oauth_error=unauthorized')
        }
      }

      // Issue JWT
      const db = getDb()
      const user = db.prepare('SELECT email, token_version FROM users LIMIT 1').get() as
        | { email: string; token_version: number }
        | undefined
      if (!user) {
        return reply.redirect('/?oauth_error=no_user')
      }

      const token = app.jwt.sign({ email: user.email, token_version: user.token_version })

      // Generate exchange code
      const exchangeCode = crypto.randomUUID()
      exchangeCodes.set(exchangeCode, { token })

      return reply.redirect(`/?oauth_code=${exchangeCode}`)
    } catch {
      return reply.redirect('/?oauth_error=exchange_failed')
    }
  })

  // POST /api/oauth/github/token — public, rate-limited
  // Shared by every external provider (GitHub, OIDC): exchanges the one-time code
  app.post('/api/oauth/github/token', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const body = parseOrBadRequest(TokenBody, request.body, reply)
    if (!body) return
    const { code } = body

    const entry = exchangeCodes.consume(code)
    if (!entry) {
      return reply.status(400).send({ error: 'Invalid or expired code' })
    }

    reply.send({ ok: true, token: entry.token })
  })

  // GET /api/oauth/github/config — requires auth
  app.get('/api/oauth/github/config', { preHandler: [requireAuth] }, async (_request, reply) => {
    const clientId = getSetting('auth.github_client_id') || ''
    const clientSecret = getSetting('auth.github_client_secret') || ''
    const allowedUsers = getSetting('auth.github_allowed_users') || ''
    const enabled = getSetting('auth.github_enabled') === '1'
    const configured = !!clientId && !!clientSecret

    reply.send({ enabled, configured, clientId, allowedUsers })
  })

  // POST /api/oauth/github/config — requires auth
  app.post('/api/oauth/github/config', { preHandler: [requireAuth] }, async (request, reply) => {
    const body = parseOrBadRequest(GithubConfigBody, request.body, reply)
    if (!body) return

    // Lockout prevention: if GitHub OAuth is the only enabled auth method,
    // don't allow breaking changes
    const isOnlyMethod = isGitHubOAuthEnabled() && !hasOtherLoginMethod('github')

    if (isOnlyMethod) {
      if (body.clientId !== undefined && !body.clientId.trim()) {
        return reply.status(400).send({ error: 'Cannot clear Client ID when GitHub OAuth is the only login method' })
      }
      if (body.clientSecret !== undefined && body.clientSecret === '') {
        return reply.status(400).send({ error: 'Cannot clear Client Secret when GitHub OAuth is the only login method' })
      }
      // allowedUsers can be empty — falls back to OAuth App owner only
    }

    if (body.clientId !== undefined) {
      upsertSetting('auth.github_client_id', body.clientId.trim())
    }
    if (body.clientSecret !== undefined && body.clientSecret !== '') {
      upsertSetting('auth.github_client_secret', body.clientSecret)
    }
    if (body.allowedUsers !== undefined) {
      upsertSetting('auth.github_allowed_users', body.allowedUsers.trim())
    }

    const clientId = getSetting('auth.github_client_id') || ''
    const allowedUsers = getSetting('auth.github_allowed_users') || ''
    const enabled = getSetting('auth.github_enabled') === '1'
    const configured = !!clientId && !!getSetting('auth.github_client_secret')

    reply.send({ ok: true, enabled, configured, clientId, allowedUsers })
  })

  // POST /api/oauth/github/toggle — requires auth
  app.post('/api/oauth/github/toggle', { preHandler: [requireAuth] }, async (request, reply) => {
    const body = parseOrBadRequest(GithubToggleBody, request.body, reply)
    if (!body) return
    const { enabled } = body

    if (enabled) {
      // Must be configured
      const clientId = getSetting('auth.github_client_id')
      const clientSecret = getSetting('auth.github_client_secret')
      if (!clientId || !clientSecret) {
        return reply.status(400).send({ error: 'GitHub OAuth is not configured' })
      }
    } else {
      // Lockout prevention
      if (!hasOtherLoginMethod('github')) {
        return reply.status(400).send({ error: 'Cannot disable GitHub OAuth without an alternative login method' })
      }
    }

    upsertSetting('auth.github_enabled', enabled ? '1' : '0')
    reply.send({ ok: true, enabled })
  })
}
