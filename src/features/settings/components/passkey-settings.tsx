import { useState } from 'react'
import useSWR from 'swr'
import { browserSupportsWebAuthn, startRegistration } from '@simplewebauthn/browser'
import { Fingerprint, Plus, Trash2 } from 'lucide-react'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { fetcher, apiDelete } from '@/lib/fetcher'

interface AuthMethods {
  password: { enabled: boolean }
  passkey: { enabled: boolean; count: number }
  github?: { enabled: boolean }
  oidc?: { enabled: boolean }
}

interface PasskeyItem {
  id: number
  credential_id: string
  device_type: string
  backed_up: number
  authenticator_name: string | null
  created_at: string
}

export function PasskeySettings() {
  const { t, locale } = useI18n()
  const [registering, setRegistering] = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const { data: methods, mutate: mutateMethods } = useSWR<AuthMethods>('/api/auth/methods', fetcher)
  const { data: passkeys, mutate: mutatePasskeys } = useSWR<PasskeyItem[]>('/api/auth/passkeys', fetcher)

  const passwordEnabled = methods?.password?.enabled !== false
  const passkeyCount = methods?.passkey?.count ?? 0
  const githubEnabled = methods?.github?.enabled === true || methods?.oidc?.enabled === true
  const webauthnSupported = browserSupportsWebAuthn()

  if (!methods || !passkeys) {
    return null
  }

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

  async function handleAddPasskey() {
    if (registering || !webauthnSupported) return
    setRegistering(true)
    setError(null)

    try {
      const optRes = await fetch('/api/auth/register/options', {
        headers: { Authorization: `Bearer ${localStorage.getItem('auth_token')}` },
      })
      if (!optRes.ok) throw new Error('Failed to get registration options')
      const options = await optRes.json()

      const { challengeId, ...optionsJSON } = options
      const regResp = await startRegistration({ optionsJSON })

      const verifyRes = await fetch('/api/auth/register/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('auth_token')}`,
        },
        body: JSON.stringify({ ...regResp, challengeId }),
      })

      if (!verifyRes.ok) {
        const data = await verifyRes.json().catch(() => ({}))
        throw new Error(data.error || 'Registration failed')
      }

      void mutatePasskeys()
      void mutateMethods()
      showMessage(t('settings.passkeyAdded'), 'success')
    } catch (err: unknown) {
      if (!(err instanceof Error) || err.name !== 'NotAllowedError') {
        showMessage(err instanceof Error ? err.message : 'Registration failed', 'error')
      }
    } finally {
      setRegistering(false)
    }
  }

  async function handleDeletePasskey(id: number) {
    if (deletingId !== null) return

    // Lockout prevention check
    if (!passwordEnabled && !githubEnabled && passkeyCount <= 1) {
      showMessage(t('settings.cannotDeleteLastPasskey'), 'error')
      return
    }

    setDeletingId(id)
    const prev = passkeys ?? []
    // Optimistic update: remove from UI immediately
    void mutatePasskeys(prev.filter(pk => pk.id !== id), false)
    void mutateMethods()
    try {
      await apiDelete(`/api/auth/passkeys/${id}`)
      showMessage(t('settings.passkeyDeleted'), 'success')
    } catch (err: unknown) {
      // Rollback on failure
      void mutatePasskeys(prev, false)
      showMessage(err instanceof Error ? err.message : 'Delete failed', 'error')
    } finally {
      setDeletingId(null)
    }
  }

  function formatDate(dateStr: string): string {
    const d = new Date(dateStr + 'Z')
    return d.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' })
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-text">{t('settings.passkeys')}</h2>
        {webauthnSupported && (
          <button
            type="button"
            onClick={handleAddPasskey}
            disabled={registering}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-accent text-accent-text hover:opacity-90 transition-opacity disabled:opacity-50 select-none"
          >
            <Plus size={14} />
            {registering ? '...' : t('settings.addPasskey')}
          </button>
        )}
      </div>

      {!webauthnSupported && (
        <p className="text-xs text-muted">WebAuthn is not supported in this browser.</p>
      )}

      {passkeys && passkeys.length > 0 ? (
        <div className="space-y-2">
          {passkeys.map(pk => (
            <div
              key={pk.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-border bg-bg-card px-4 py-3"
            >
              <div className="flex items-center gap-3 min-w-0">
                <Fingerprint size={20} className="text-muted shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm text-text truncate">
                    {pk.authenticator_name ?? (pk.device_type === 'multiDevice' ? t('settings.multiDevice') : t('settings.singleDevice'))}
                  </p>
                  <p className="text-xs text-muted">{formatDate(pk.created_at)}</p>
                </div>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => handleDeletePasskey(pk.id)}
                    disabled={deletingId === pk.id}
                    className="shrink-0 p-1.5 rounded-lg text-muted hover:text-error hover:bg-hover transition-colors disabled:opacity-50 select-none"
                  >
                    <Trash2 size={15} />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{t('settings.deletePasskey')}</TooltipContent>
              </Tooltip>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted">{t('settings.noPasskeys')}</p>
      )}

      {error && (
        <p className="mt-3 text-sm text-error">{error}</p>
      )}
      {success && (
        <p className="mt-3 text-sm text-accent">{success}</p>
      )}
    </section>
  )
}
