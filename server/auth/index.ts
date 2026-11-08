import type { FastifyInstance } from 'fastify'
import { authRoutes } from './routes.js'
import { passkeyRoutes } from './passkey-routes.js'
import { oauthRoutes } from './oauth-routes.js'
import { oidcRoutes } from './oidc-routes.js'

export {
  requireAuth,
  requireMediaAuth,
  getAuthUser,
  requireWriteScope,
  getOrigin,
  getRpID,
  getCredentialCount,
  requireJson,
} from './guards.js'
export {
  createApiKey,
  listApiKeys,
  deleteApiKey,
  validateApiKey,
} from './api-keys-db.js'
export type { ApiKey, ApiKeyCreated } from './api-keys-db.js'
export { apiKeyRoutes } from './api-key-routes.js'
export { mediaCookieRoutes, clearMediaCookie, MEDIA_COOKIE } from './media-cookie.js'
export { authRoutes, passkeyRoutes, oauthRoutes, oidcRoutes }

export function registerAuthRoutes(app: FastifyInstance): void {
  app.register(authRoutes)
  app.register(passkeyRoutes)
  app.register(oauthRoutes)
  app.register(oidcRoutes)
}
