import { getSetting } from '../db.js'
import { getCredentialCount } from './guards.js'
import { TtlStore } from '../lib/ttl-store.js'

/**
 * State shared by the external login providers (GitHub OAuth, generic OIDC).
 * Kept in its own module so the provider route files don't import each other.
 */

const CODE_TTL = 60_000 // 60 sec

/** One-time codes exchanged for a JWT via POST /api/oauth/github/token. */
export const exchangeCodes = new TtlStore<{ token: string }>(CODE_TTL)

export function isGitHubOAuthEnabled(): boolean {
  return getSetting('auth.github_enabled') === '1'
    && !!getSetting('auth.github_client_id')
    && !!getSetting('auth.github_client_secret')
}

/** Allowed OIDC identities (email, preferred_username or sub), lowercased. */
export function getOidcAllowedUsers(): string[] {
  return (getSetting('auth.oidc_allowed_users') || '')
    .split(',')
    .map(u => u.trim().toLowerCase())
    .filter(Boolean)
}

export function isOidcConfigured(): boolean {
  return !!getSetting('auth.oidc_issuer')
    && !!getSetting('auth.oidc_client_id')
}

export function isOidcEnabled(): boolean {
  return getSetting('auth.oidc_enabled') === '1' && isOidcConfigured()
}

/**
 * Whether a login method other than the one named remains usable.
 * Used for lockout prevention when disabling or breaking a method.
 */
export function hasOtherLoginMethod(except: 'password' | 'passkey' | 'github' | 'oidc'): boolean {
  if (except !== 'password' && getSetting('auth.password_enabled') !== '0') return true
  if (except !== 'passkey' && getCredentialCount() > 0) return true
  if (except !== 'github' && isGitHubOAuthEnabled()) return true
  if (except !== 'oidc' && isOidcEnabled()) return true
  return false
}
