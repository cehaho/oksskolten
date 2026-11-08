import { useState, useEffect, useRef, type FormEvent } from 'react'
import { browserSupportsWebAuthn, startAuthentication } from '@simplewebauthn/browser'
import { Input } from '../components/ui/input'
import { FormField } from '../components/ui/form-field'
import { useI18n } from '@/i18n'
import { useDarkMode, useTheme } from '@/hooks/preferences'
import { Fingerprint, Github, KeyRound } from 'lucide-react'
import { SetupPage } from './setup-page'

interface AuthMethods {
  setup_required?: boolean
  password: { enabled: boolean }
  passkey: { enabled: boolean; count: number }
  github?: { enabled: boolean }
  oidc?: { enabled: boolean; name: string }
}

export function LoginPage({ onLogin }: { onLogin?: (token: string) => void }) {
  const { t } = useI18n()
  const { isDark } = useDarkMode()
  useTheme(isDark)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [passkeyLoading, setPasskeyLoading] = useState(false)
  const [methods, setMethods] = useState<AuthMethods | null>(null)
  const [githubLoading, setGithubLoading] = useState(false)
  const [oidcLoading, setOidcLoading] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Prevent browser/PWA from auto-focusing form inputs on mount.
  // Browsers (especially mobile PWA) may autofocus with a delay after render,
  // so we repeatedly blur any focused input for a short window.
  useEffect(() => {
    containerRef.current?.focus()
    const timer = setInterval(() => {
      const el = document.activeElement
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        el.blur()
      }
    }, 50)
    const cleanup = setTimeout(() => clearInterval(timer), 500)
    return () => { clearInterval(timer); clearTimeout(cleanup) }
  }, [])

  useEffect(() => {
    fetch('/api/auth/methods')
      .then(r => r.json())
      .then(setMethods)
      .catch(() => {
        // Fallback: assume password-only
        setMethods({ password: { enabled: true }, passkey: { enabled: false, count: 0 } })
      })
  }, [])

  // Handle oauth_error query parameter
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('oauth_error')) {
      setError(t('login.ssoError'))
      params.delete('oauth_error')
      const clean = params.toString()
      window.history.replaceState({}, '', clean ? `/?${clean}` : '/')
    }
  }, [t])

  if (methods?.setup_required && onLogin) {
    return <SetupPage onLogin={onLogin} />
  }

  const showPasskey = methods?.passkey?.enabled && methods.passkey.count > 0 && browserSupportsWebAuthn()
  const showGitHub = methods?.github?.enabled === true
  const showOidc = methods?.oidc?.enabled === true
  const oidcName = methods?.oidc?.name || 'OIDC'
  const showPassword = methods?.password?.enabled !== false

  async function handlePasskeyLogin() {
    setError(null)
    setPasskeyLoading(true)
    try {
      const optRes = await fetch('/api/auth/login/options')
      if (!optRes.ok) throw new Error('Failed to get options')
      const options = await optRes.json()

      const { challengeId, ...optionsJSON } = options
      const authResp = await startAuthentication({ optionsJSON })

      const verifyRes = await fetch('/api/auth/login/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...authResp, challengeId }),
      })

      if (!verifyRes.ok) {
        setError(t('login.passkeyError'))
        return
      }

      const data = await verifyRes.json()
      if (onLogin && data.token) {
        onLogin(data.token)
      } else {
        window.location.href = '/'
      }
    } catch (err: unknown) {
      // NotAllowedError = user cancelled the dialog
      if (!(err instanceof Error) || err.name !== 'NotAllowedError') {
        setError(t('login.passkeyError'))
      }
    } finally {
      setPasskeyLoading(false)
    }
  }

  async function handleGitHubLogin() {
    setError(null)
    setGithubLoading(true)
    try {
      const res = await fetch('/api/oauth/github/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origin: window.location.origin }),
      })
      if (!res.ok) throw new Error('Failed')
      const { url } = await res.json()
      window.location.href = url
    } catch {
      setError(t('login.githubError'))
      setGithubLoading(false)
    }
  }

  async function handleOidcLogin() {
    setError(null)
    setOidcLoading(true)
    try {
      const res = await fetch('/api/oauth/oidc/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origin: window.location.origin }),
      })
      if (!res.ok) throw new Error('Failed')
      const { url } = await res.json()
      window.location.href = url
    } catch {
      setError(t('login.oidcError', { name: oidcName }))
      setOidcLoading(false)
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })

      if (!res.ok) {
        setError(t('login.failed'))
        return
      }

      const data = await res.json()
      if (onLogin && data.token) {
        onLogin(data.token)
      } else {
        window.location.href = '/'
      }
    } catch {
      setError(t('login.networkError'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-sidebar px-4 outline-none" ref={containerRef} tabIndex={-1}>
      <div className="w-full max-w-sm rounded-2xl border border-border bg-bg shadow-lg p-8">
        <h1 className="mb-1.5 text-xl font-bold text-text select-none">{t('login.title')}</h1>
        <p className="mb-6 text-sm text-muted select-none">{t('login.subtitle')}</p>

        {(showPasskey || showGitHub || showOidc) && (
          <>
            {showPasskey && (
              <button
                type="button"
                onClick={handlePasskeyLogin}
                disabled={passkeyLoading}
                className="w-full flex items-center justify-center gap-2 rounded-lg border border-border bg-bg-card px-4 py-2.5 text-sm font-medium text-text transition-colors hover:bg-hover disabled:opacity-50 select-none"
              >
                <Fingerprint size={18} />
                {passkeyLoading ? t('login.loading') : t('login.passkey')}
              </button>
            )}

            {showGitHub && (
              <button
                type="button"
                onClick={handleGitHubLogin}
                disabled={githubLoading}
                className={`w-full flex items-center justify-center gap-2 rounded-lg border border-border bg-bg-card px-4 py-2.5 text-sm font-medium text-text transition-colors hover:bg-hover disabled:opacity-50 select-none${showPasskey ? ' mt-2' : ''}`}
              >
                <Github size={18} />
                {githubLoading ? t('login.loading') : t('login.github')}
              </button>
            )}

            {showOidc && (
              <button
                type="button"
                onClick={handleOidcLogin}
                disabled={oidcLoading}
                className={`w-full flex items-center justify-center gap-2 rounded-lg border border-border bg-bg-card px-4 py-2.5 text-sm font-medium text-text transition-colors hover:bg-hover disabled:opacity-50 select-none${showPasskey || showGitHub ? ' mt-2' : ''}`}
              >
                <KeyRound size={18} />
                {oidcLoading ? t('login.loading') : t('login.oidc', { name: oidcName })}
              </button>
            )}

            {showPassword && (
              <div className="relative my-5">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center">
                  <span className="bg-bg px-3 text-xs text-muted select-none">{t('login.or')}</span>
                </div>
              </div>
            )}
          </>
        )}

        {showPassword && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <FormField label={t('login.email')} htmlFor="email">
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="py-2.5"
              />
            </FormField>

            <FormField label={t('login.password')} htmlFor="password">
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="py-2.5"
              />
            </FormField>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-text transition-opacity hover:opacity-80 disabled:opacity-50 select-none"
            >
              {loading ? t('login.loading') : t('login.submit')}
            </button>
          </form>
        )}

        {error && (
          <p className="mt-4 text-sm text-error">{error}</p>
        )}
      </div>
    </div>
  )
}
