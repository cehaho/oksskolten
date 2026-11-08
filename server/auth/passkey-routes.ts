import crypto from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server'
import type { AuthenticatorTransportFuture, RegistrationResponseJSON, AuthenticationResponseJSON } from '@simplewebauthn/server'
import { z } from 'zod'
import { getDb, getSetting, upsertSetting } from '../db.js'
import { requireAuth, getOrigin, getRpID, getCredentialCount } from './guards.js'
import { hasOtherLoginMethod, isGitHubOAuthEnabled, isOidcEnabled } from './sso.js'
import { getOidcDisplayName } from './oidc-routes.js'
import { TtlStore } from '../lib/ttl-store.js'
import { NumericIdParams, parseOrBadRequest } from '../lib/validation.js'
import aaguidData from './aaguids.json' with { type: 'json' }

const RegisterVerifyBody = z.object({
  challengeId: z.string().optional(),
}).passthrough()

const LoginVerifyBody = z.object({
  id: z.string(),
  challengeId: z.string().optional(),
}).passthrough()

const PasswordToggleBody = z.object({
  enabled: z.boolean(),
})

// --- AAGUID → authenticator name lookup ---

const ZERO_AAGUID = '00000000-0000-0000-0000-000000000000'

const aaguidMap: Record<string, string> = aaguidData

function resolveAuthenticatorName(aaguid: string | null): string | null {
  if (!aaguid || aaguid === ZERO_AAGUID) return null
  return aaguidMap[aaguid] ?? null
}

// --- Challenge store (in-memory, TTL 60s) ---

const CHALLENGE_TTL = 60_000
const challenges = new TtlStore<string>(CHALLENGE_TTL)

function storeChallenge(challenge: string): string {
  const key = crypto.randomUUID()
  challenges.set(key, challenge)
  return key
}

function consumeChallenge(key: string): string | null {
  return challenges.consume(key)
}

// --- DB helpers ---

interface CredentialRow {
  id: number
  credential_id: string
  public_key: Buffer
  counter: number
  device_type: string
  backed_up: number
  transports: string | null
  aaguid: string | null
  created_at: string
}

function getCredentials(): CredentialRow[] {
  const db = getDb()
  return db.prepare('SELECT * FROM credentials ORDER BY created_at ASC').all() as CredentialRow[]
}

function getCredentialByCredentialId(credentialId: string): CredentialRow | undefined {
  const db = getDb()
  return db.prepare('SELECT * FROM credentials WHERE credential_id = ?').get(credentialId) as CredentialRow | undefined
}

// --- Routes ---

export async function passkeyRoutes(app: FastifyInstance): Promise<void> {
  // Cache-Control: no-store on all auth routes
  app.addHook('onRequest', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store')
  })

  // GET /api/auth/methods — public
  app.get('/api/auth/methods', async (_request, reply) => {
    const db = getDb()
    const userCount = (db.prepare('SELECT COUNT(*) AS cnt FROM users').get() as { cnt: number }).cnt
    const passwordEnabled = getSetting('auth.password_enabled') !== '0'
    const passkeyCount = getCredentialCount()
    const githubEnabled = isGitHubOAuthEnabled()
    reply.send({
      setup_required: userCount === 0,
      password: { enabled: passwordEnabled },
      passkey: { enabled: passkeyCount > 0, count: passkeyCount },
      github: { enabled: githubEnabled },
      oidc: { enabled: isOidcEnabled(), name: getOidcDisplayName() },
    })
  })

  // GET /api/auth/passkeys — requires auth (list registered passkeys)
  app.get('/api/auth/passkeys', { preHandler: [requireAuth] }, async (_request, reply) => {
    const creds = getCredentials()
    reply.send(creds.map(c => ({
      id: c.id,
      credential_id: c.credential_id,
      device_type: c.device_type,
      backed_up: c.backed_up,
      authenticator_name: resolveAuthenticatorName(c.aaguid),
      created_at: c.created_at,
    })))
  })

  // GET /api/auth/register/options — requires auth
  app.get('/api/auth/register/options', { preHandler: [requireAuth] }, async (request, reply) => {
    const rpID = getRpID(request)
    const existingCreds = getCredentials()

    const options = await generateRegistrationOptions({
      rpName: 'Oksskolten',
      rpID,
      userName: request.authUser || 'user',
      excludeCredentials: existingCreds.map(c => ({
        id: c.credential_id,
        transports: c.transports ? JSON.parse(c.transports) as AuthenticatorTransportFuture[] : undefined,
      })),
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
    })

    const challengeId = storeChallenge(options.challenge)
    reply.send({ ...options, challengeId })
  })

  // POST /api/auth/register/verify — requires auth
  app.post('/api/auth/register/verify', { preHandler: [requireAuth] }, async (request, reply) => {
    const parsed = parseOrBadRequest(RegisterVerifyBody, request.body, reply)
    if (!parsed) return
    const body = parsed as RegistrationResponseJSON & typeof parsed
    const expectedChallenge = consumeChallenge(body.challengeId ?? '')
    if (!expectedChallenge) {
      return reply.status(400).send({ error: 'Challenge expired or missing' })
    }

    const rpID = getRpID(request)
    const origin = getOrigin(request)

    try {
      const verification = await verifyRegistrationResponse({
        response: body,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
      })

      if (!verification.verified || !verification.registrationInfo) {
        return reply.status(400).send({ error: 'Registration verification failed' })
      }

      const { credential, credentialDeviceType, credentialBackedUp, aaguid } = verification.registrationInfo

      const db = getDb()
      db.prepare(`
        INSERT INTO credentials (credential_id, public_key, counter, device_type, backed_up, transports, aaguid)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        credential.id,
        Buffer.from(credential.publicKey),
        credential.counter,
        credentialDeviceType,
        credentialBackedUp ? 1 : 0,
        credential.transports ? JSON.stringify(credential.transports) : null,
        aaguid || null,
      )

      reply.send({ ok: true })
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : 'Registration failed' })
    }
  })

  // GET /api/auth/login/options — public
  app.get('/api/auth/login/options', async (request, reply) => {
    const rpID = getRpID(request)
    const creds = getCredentials()

    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials: creds.map(c => ({
        id: c.credential_id,
        transports: c.transports ? JSON.parse(c.transports) as AuthenticatorTransportFuture[] : undefined,
      })),
      userVerification: 'preferred',
    })

    const challengeId = storeChallenge(options.challenge)
    reply.send({ ...options, challengeId })
  })

  // POST /api/auth/login/verify — public, rate-limited
  app.post('/api/auth/login/verify', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const parsed = parseOrBadRequest(LoginVerifyBody, request.body, reply)
    if (!parsed) return
    const body = parsed as AuthenticationResponseJSON & typeof parsed
    const expectedChallenge = consumeChallenge(body.challengeId ?? '')
    if (!expectedChallenge) {
      return reply.status(400).send({ error: 'Challenge expired or missing' })
    }

    const credentialId = body.id

    const credRow = getCredentialByCredentialId(credentialId)
    if (!credRow) {
      return reply.status(400).send({ error: 'Invalid credentials' })
    }

    const rpID = getRpID(request)
    const origin = getOrigin(request)

    try {
      const verification = await verifyAuthenticationResponse({
        response: body,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: [rpID],
        credential: {
          id: credRow.credential_id,
          publicKey: new Uint8Array(credRow.public_key),
          counter: credRow.counter,
          transports: credRow.transports ? JSON.parse(credRow.transports) as AuthenticatorTransportFuture[] : undefined,
        },
      })

      if (!verification.verified) {
        return reply.status(400).send({ error: 'Authentication verification failed' })
      }

      // Update counter
      const db = getDb()
      db.prepare('UPDATE credentials SET counter = ? WHERE credential_id = ?')
        .run(verification.authenticationInfo.newCounter, credentialId)

      // Issue JWT (same as password login)
      const user = db.prepare('SELECT email, token_version FROM users LIMIT 1').get() as
        | { email: string; token_version: number }
        | undefined

      if (!user) {
        return reply.status(500).send({ error: 'No user configured' })
      }

      const token = app.jwt.sign({ email: user.email, token_version: user.token_version })
      reply.send({ ok: true, token })
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : 'Authentication failed' })
    }
  })

  // DELETE /api/auth/passkeys/:id — requires auth
  app.delete('/api/auth/passkeys/:id', { preHandler: [requireAuth] }, async (request, reply) => {
    const params = parseOrBadRequest(NumericIdParams, request.params, reply)
    if (!params) return
    const numId = params.id

    // Lockout prevention: don't delete the last passkey if no other auth method is enabled
    if (getCredentialCount() <= 1 && !hasOtherLoginMethod('passkey')) {
      return reply.status(400).send({
        error: 'Cannot delete the last passkey without an alternative login method',
      })
    }

    const db = getDb()
    const result = db.prepare('DELETE FROM credentials WHERE id = ?').run(numId)
    if (result.changes === 0) {
      return reply.status(404).send({ error: 'Passkey not found' })
    }

    reply.send({ ok: true })
  })

  // POST /api/auth/password/toggle — requires auth
  app.post('/api/auth/password/toggle', { preHandler: [requireAuth] }, async (request, reply) => {
    const body = parseOrBadRequest(PasswordToggleBody, request.body, reply)
    if (!body) return
    const wantEnabled = body.enabled

    if (!wantEnabled) {
      // Cannot disable password if no other auth method is available
      if (!hasOtherLoginMethod('password')) {
        return reply.status(400).send({
          error: 'Cannot disable password authentication without an alternative login method',
        })
      }
    }

    upsertSetting('auth.password_enabled', wantEnabled ? '1' : '0')
    reply.send({ ok: true, enabled: wantEnabled })
  })
}
