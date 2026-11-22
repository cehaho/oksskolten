import crypto from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { OAuth2Client, CodeChallengeMethod, generateState, generateCodeVerifier } from 'arctic'
import { getDb, getSetting, upsertSetting } from '../db.js'
import { requireAuth, getOrigin } from './guards.js'
import { TtlStore } from '../lib/ttl-store.js'
import { parseOrBadRequest } from '../lib/validation.js'
import { exchangeCodes, getOidcAllowedUsers, hasOtherLoginMethod, isOidcConfigured, isOidcEnabled } from './sso.js'

export { isOidcEnabled }

/**
 * Generic OpenID Connect login (Pocket ID, Authelia, Authentik, Keycloak, ...).
 * Endpoints are read from the issuer's discovery document; the user is
 * identified through the userinfo endpoint and, when an allow list is set,
 * matched against it. With an empty allow list, access control is delegated to
 * the provider (e.g. Pocket ID's allowed user groups on the client).
 * The callback ends with the same one-time exchange code as GitHub OAuth.
 */

const DEFAULT_DISPLAY_NAME = 'Pocket ID'
const STATE_TTL = 300_000 // 5 min
const DISCOVERY_TTL = 3_600_000 // 1 hour
const DISCOVERY_TIMEOUT = 10_000

const AuthorizeBody = z.object({
  origin: z.string().optional(),
})

const CallbackQuery = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
})

const OidcConfigBody = z.object({
  issuer: z.string().optional(),
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  allowedUsers: z.string().optional(),
  displayName: z.string().max(40).optional(),
})

const OidcToggleBody = z.object({
  enabled: z.boolean(),
})

const DiscoveryDoc = z.object({
  issuer: z.string(),
  authorization_endpoint: z.string().url(),
  token_endpoint: z.string().url(),
  userinfo_endpoint: z.string().url(),
})
type Discovery = z.infer<typeof DiscoveryDoc>

const UserInfo = z.object({
  sub: z.string(),
  email: z.string().optional(),
  email_verified: z.boolean().optional(),
  preferred_username: z.string().optional(),
})

const oidcStates = new TtlStore<{ redirectURI: string; codeVerifier: string }>(STATE_TTL)
let discoveryCache: { issuer: string; doc: Discovery; expires: number } | null = null

// --- Helpers ---

function normalizeIssuer(raw: string): string {
  return raw.trim().replace(/\/+$/, '')
}

function isValidIssuer(issuer: string): boolean {
  try {
    const url = new URL(issuer)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

export function clearOidcDiscoveryCache(): void {
  discoveryCache = null
}

async function discover(issuer: string): Promise<Discovery> {
  if (discoveryCache && discoveryCache.issuer === issuer && Date.now() < discoveryCache.expires) {
    return discoveryCache.doc
  }
  const res = await fetch(`${issuer}/.well-known/openid-configuration`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(DISCOVERY_TIMEOUT),
  })
  if (!res.ok) throw new Error(`OIDC discovery failed: HTTP ${res.status}`)
  const doc = DiscoveryDoc.parse(await res.json())
  if (normalizeIssuer(doc.issuer) !== issuer) {
    throw new Error('OIDC discovery issuer mismatch')
  }
  discoveryCache = { issuer, doc, expires: Date.now() + DISCOVERY_TTL }
  return doc
}

function createClient(redirectURI: string): OAuth2Client {
  const clientId = getSetting('auth.oidc_client_id')!
  const clientSecret = getSetting('auth.oidc_client_secret') || null
  return new OAuth2Client(clientId, clientSecret, redirectURI)
}

function configResponse() {
  return {
    enabled: getSetting('auth.oidc_enabled') === '1',
    configured: isOidcConfigured(),
    issuer: getSetting('auth.oidc_issuer') || '',
    clientId: getSetting('auth.oidc_client_id') || '',
    hasClientSecret: !!getSetting('auth.oidc_client_secret'),
    allowedUsers: getSetting('auth.oidc_allowed_users') || '',
    displayName: getOidcDisplayName(),
  }
}

export function getOidcDisplayName(): string {
  return getSetting('auth.oidc_display_name') || DEFAULT_DISPLAY_NAME
}

// --- Routes ---

export async function oidcRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store')
  })

  // POST /api/oauth/oidc/authorize — public
  app.post('/api/oauth/oidc/authorize', async (request, reply) => {
    if (!isOidcEnabled()) {
      return reply.status(400).send({ error: 'OIDC login is not enabled' })
    }
    const body = parseOrBadRequest(AuthorizeBody, request.body, reply)
    if (!body) return

    const origin = body.origin || getOrigin(request)
    const redirectURI = `${origin}/api/oauth/oidc/callback`

    let doc: Discovery
    try {
      doc = await discover(getSetting('auth.oidc_issuer')!)
    } catch (err) {
      request.log.warn({ err }, 'OIDC discovery failed')
      return reply.status(502).send({ error: 'Could not reach the OIDC provider' })
    }

    const state = generateState()
    const codeVerifier = generateCodeVerifier()
    oidcStates.set(state, { redirectURI, codeVerifier })

    const url = createClient(redirectURI).createAuthorizationURLWithPKCE(
      doc.authorization_endpoint, state, CodeChallengeMethod.S256, codeVerifier,
      ['openid', 'email', 'profile'],
    )
    reply.send({ url: url.toString() })
  })

  // GET /api/oauth/oidc/callback — public, rate-limited
  app.get('/api/oauth/oidc/callback', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { code, state, error } = CallbackQuery.parse(request.query)

    const stateEntry = state ? oidcStates.consume(state) : null
    if (!stateEntry) return reply.redirect('/?oauth_error=invalid_state')
    if (error) return reply.redirect('/?oauth_error=provider_denied')
    if (!code) return reply.redirect('/?oauth_error=missing_code')
    if (!isOidcEnabled()) return reply.redirect('/?oauth_error=not_configured')

    try {
      const doc = await discover(getSetting('auth.oidc_issuer')!)
      const tokens = await createClient(stateEntry.redirectURI)
        .validateAuthorizationCode(doc.token_endpoint, code, stateEntry.codeVerifier)

      const userRes = await fetch(doc.userinfo_endpoint, {
        headers: { Authorization: `Bearer ${tokens.accessToken()}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(DISCOVERY_TIMEOUT),
      })
      if (!userRes.ok) return reply.redirect('/?oauth_error=userinfo_error')
      const info = UserInfo.parse(await userRes.json())

      // Optional allow list: email (unless explicitly unverified),
      // preferred_username, or sub. Empty = trust the provider's access control.
      const allowed = getOidcAllowedUsers()
      if (allowed.length > 0) {
        const identities = [
          info.email_verified === false ? undefined : info.email,
          info.preferred_username,
          info.sub,
        ].filter((v): v is string => !!v).map(v => v.toLowerCase())
        if (!identities.some(id => allowed.includes(id))) {
          return reply.redirect('/?oauth_error=unauthorized')
        }
      }

      const user = getDb().prepare('SELECT email, token_version FROM users LIMIT 1').get() as
        | { email: string; token_version: number }
        | undefined
      if (!user) return reply.redirect('/?oauth_error=no_user')

      const token = app.jwt.sign({ email: user.email, token_version: user.token_version })
      const exchangeCode = crypto.randomUUID()
      exchangeCodes.set(exchangeCode, { token })
      return reply.redirect(`/?oauth_code=${exchangeCode}`)
    } catch (err) {
      request.log.warn({ err }, 'OIDC callback failed')
      return reply.redirect('/?oauth_error=exchange_failed')
    }
  })

  // GET /api/oauth/oidc/config — requires auth
  app.get('/api/oauth/oidc/config', { preHandler: [requireAuth] }, async (_request, reply) => {
    reply.send(configResponse())
  })

  // POST /api/oauth/oidc/config — requires auth
  app.post('/api/oauth/oidc/config', { preHandler: [requireAuth] }, async (request, reply) => {
    const body = parseOrBadRequest(OidcConfigBody, request.body, reply)
    if (!body) return

    let issuer: string | undefined
    if (body.issuer !== undefined) {
      issuer = normalizeIssuer(body.issuer)
      if (issuer && !isValidIssuer(issuer)) {
        return reply.status(400).send({ error: 'Issuer must be an http(s) URL' })
      }
    }

    // Lockout prevention: when OIDC is the only login method, refuse changes
    // that would leave it unconfigured
    if (isOidcEnabled() && !hasOtherLoginMethod('oidc')) {
      if ((issuer !== undefined && !issuer)
        || (body.clientId !== undefined && !body.clientId.trim())) {
        return reply.status(400).send({ error: 'Cannot clear OIDC settings when OIDC is the only login method' })
      }
    }

    if (issuer !== undefined) {
      upsertSetting('auth.oidc_issuer', issuer)
      clearOidcDiscoveryCache()
    }
    if (body.clientId !== undefined) upsertSetting('auth.oidc_client_id', body.clientId.trim())
    if (body.clientSecret !== undefined && body.clientSecret !== '') {
      upsertSetting('auth.oidc_client_secret', body.clientSecret)
    }
    if (body.allowedUsers !== undefined) upsertSetting('auth.oidc_allowed_users', body.allowedUsers.trim())
    if (body.displayName !== undefined) upsertSetting('auth.oidc_display_name', body.displayName.trim())

    reply.send({ ok: true, ...configResponse() })
  })

  // POST /api/oauth/oidc/toggle — requires auth
  app.post('/api/oauth/oidc/toggle', { preHandler: [requireAuth] }, async (request, reply) => {
    const body = parseOrBadRequest(OidcToggleBody, request.body, reply)
    if (!body) return

    if (body.enabled) {
      if (!isOidcConfigured()) {
        return reply.status(400).send({ error: 'OIDC is not configured (issuer and client ID are required)' })
      }
    } else if (!hasOtherLoginMethod('oidc')) {
      return reply.status(400).send({ error: 'Cannot disable OIDC without an alternative login method' })
    }

    upsertSetting('auth.oidc_enabled', body.enabled ? '1' : '0')
    reply.send({ ok: true, enabled: body.enabled })
  })
}
