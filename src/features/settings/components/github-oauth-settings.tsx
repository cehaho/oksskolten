import { useState } from 'react'
import useSWR from 'swr'
import { AlertTriangle, Copy, Check, Info, ChevronDown, ExternalLink } from 'lucide-react'
import { useI18n } from '@/i18n'
import { Input } from '@/components/ui/input'
import { fetcher, apiPost } from '@/lib/fetcher'

interface OAuthConfig {
  enabled: boolean
  configured: boolean
  clientId: string
  allowedUsers: string
}

interface AuthMethods {
  password: { enabled: boolean }
  passkey: { enabled: boolean; count: number }
  github?: { enabled: boolean }
  oidc?: { enabled: boolean }
}

export function GitHubOAuthSettings() {
  const { t } = useI18n()
  const [guideOpen, setGuideOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [toggling, setToggling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const { data: config, mutate: mutateConfig } = useSWR<OAuthConfig>('/api/oauth/github/config', fetcher)
  const { data: methods, mutate: mutateMethods } = useSWR<AuthMethods>('/api/auth/methods', fetcher)

  const [clientId, setClientId] = useState<string | null>(null)
  const [clientSecret, setClientSecret] = useState('')
  const [allowedUsers, setAllowedUsers] = useState<string | null>(null)

  // Use local state if edited, otherwise config
  const displayClientId = clientId ?? config?.clientId ?? ''
  const displayAllowedUsers = allowedUsers ?? config?.allowedUsers ?? ''
  const callbackUrl = `${window.location.origin}/api/oauth/github/callback`

  const passwordEnabled = methods?.password?.enabled !== false
  const passkeyCount = methods?.passkey?.count ?? 0
  const canDisableGithub = passwordEnabled || passkeyCount > 0 || methods?.oidc?.enabled === true

  if (!config || !methods) return null

  function showMessage(msg: string, type: 'error' | 'success') {
    if (type === 'error') {
      setError(msg)
      setSuccess(null)
    } else {
      setSuccess(msg)
      setError(null)
    }
    setTimeout(() => { setError(null); setSuccess(null) }, 3000)
  }

  async function handleSave() {
    if (saving) return
    setSaving(true)
    try {
      const body: Record<string, string> = {}
      if (clientId !== null) body.clientId = clientId
      if (clientSecret) body.clientSecret = clientSecret
      if (allowedUsers !== null) body.allowedUsers = allowedUsers
      await apiPost('/api/oauth/github/config', body)
      void mutateConfig()
      void mutateMethods()
      setClientSecret('')
      setClientId(null)
      setAllowedUsers(null)
      showMessage(t('settings.githubSaved'), 'success')
    } catch (err: unknown) {
      showMessage(err instanceof Error ? err.message : 'Save failed', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleToggle() {
    if (toggling || !config) return
    const newEnabled = !config.enabled

    if (!newEnabled && !canDisableGithub) {
      showMessage(t('settings.cannotDisableGithub'), 'error')
      return
    }

    setToggling(true)
    try {
      await apiPost('/api/oauth/github/toggle', { enabled: newEnabled })
      void mutateConfig()
      void mutateMethods()
    } catch (err: unknown) {
      showMessage(err instanceof Error ? err.message : 'Toggle failed', 'error')
    } finally {
      setToggling(false)
    }
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(callbackUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const isDirty = clientId !== null || clientSecret !== '' || allowedUsers !== null

  return (
    <section>
      <h2 className="text-base font-semibold text-text mb-4">{t('settings.githubOauth')}</h2>
      <p className="text-xs text-muted mb-4">{t('settings.githubOauthDesc')}</p>

      {/* Setup guide */}
      <div className="mb-4 rounded-lg border border-border bg-bg-card overflow-hidden">
        <button
          type="button"
          onClick={() => setGuideOpen(v => !v)}
          className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-medium text-text hover:bg-hover transition-colors select-none"
        >
          <Info size={14} className="text-muted shrink-0" />
          {t('settings.githubGuideTitle')}
          <ChevronDown size={14} className={`ml-auto text-muted shrink-0 transition-transform ${guideOpen ? 'rotate-180' : ''}`} />
        </button>
        {guideOpen && (
          <div className="px-3 pb-3 space-y-2.5 text-xs text-muted border-t border-border pt-2.5">
            <p>
              <span className="font-medium text-text select-none">1.</span>{' '}
              <a
                href="https://github.com/settings/developers"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline inline-flex items-center gap-0.5"
              >
                GitHub Developer Settings
                <ExternalLink size={11} />
              </a>
              {' '}{t('settings.githubGuideStep1')}
            </p>
            <p>
              <span className="font-medium text-text select-none">2.</span>{' '}
              {t('settings.githubGuideStep2')}
            </p>
            <div className="ml-3.5 space-y-1">
              <p><span className="text-text">Application name:</span> {t('settings.githubGuideAppName')}</p>
              <p><span className="text-text">Homepage URL:</span> <code className="text-text bg-bg px-1 rounded">{window.location.origin}</code></p>
              <p>
                <span className="text-text">Callback URL:</span>{' '}
                <code className="text-text bg-bg px-1 rounded">{callbackUrl}</code>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="inline-flex ml-1 p-0.5 text-muted hover:text-text transition-colors select-none align-middle"
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                </button>
              </p>
            </div>
            <p>
              <span className="font-medium text-text select-none">3.</span>{' '}
              {t('settings.githubGuideStep3')}
            </p>
          </div>
        )}
      </div>

      <div className="space-y-3">
        {/* Client ID */}
        <div>
          <label className="block text-xs text-muted mb-1 select-none">{t('settings.githubClientId')}</label>
          <Input
            type="text"
            value={displayClientId}
            onChange={e => setClientId(e.target.value)}
            placeholder="Iv1.xxxxxxxxxxxx"
          />
        </div>

        {/* Client Secret */}
        <div>
          <label className="block text-xs text-muted mb-1 select-none">{t('settings.githubClientSecret')}</label>
          <Input
            type="password"
            value={clientSecret}
            onChange={e => setClientSecret(e.target.value)}
            placeholder={config.configured ? '••••••••' : ''}
          />
        </div>

        {/* Allowed Users */}
        <div>
          <label className="flex items-center gap-1 text-xs text-muted mb-1 select-none">
            {t('settings.githubAllowedUsers')}
            <span className="relative group">
              <Info size={13} className="text-muted cursor-help" />
              <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-full mb-1.5 w-72 rounded-lg border border-border bg-bg-card px-3 py-2.5 text-xs text-muted shadow-lg opacity-0 group-hover:opacity-100 transition-opacity z-10 whitespace-pre-line">
                {t('settings.githubAllowedUsersDesc')}
              </span>
            </span>
          </label>
          <Input
            type="text"
            value={displayAllowedUsers}
            onChange={e => setAllowedUsers(e.target.value)}
            placeholder={t('settings.githubAllowedUsersPlaceholder')}
          />
        </div>

        {/* Save button */}
        {isDirty && (
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-accent text-accent-text hover:opacity-90 transition-opacity disabled:opacity-50 select-none"
          >
            {saving ? '...' : t('settings.githubSave')}
          </button>
        )}
      </div>

      {/* Toggle — only show when configured */}
      {config.configured && (
        <div className="mt-5">
          <label className="flex items-center gap-3 cursor-pointer">
            <button
              type="button"
              role="switch"
              aria-checked={config.enabled}
              onClick={handleToggle}
              disabled={toggling || (config.enabled && !canDisableGithub)}
              className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                config.enabled ? 'bg-accent' : 'bg-border'
              } disabled:opacity-50`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                  config.enabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
            <span className="text-sm text-text select-none">
              {config.enabled ? 'On' : 'Off'}
            </span>
          </label>

          {config.enabled && !canDisableGithub && (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-muted">
              <AlertTriangle size={13} />
              {t('settings.cannotDisableGithub')}
            </p>
          )}
        </div>
      )}

      {!config.configured && (
        <p className="mt-3 text-xs text-muted">{t('settings.githubNotConfigured')}</p>
      )}

      {/* Messages */}
      {error && <p className="mt-3 text-sm text-error">{error}</p>}
      {success && <p className="mt-3 text-sm text-accent">{success}</p>}
    </section>
  )
}
