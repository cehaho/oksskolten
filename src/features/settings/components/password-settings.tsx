import { useState } from 'react'
import useSWR from 'swr'
import { AlertTriangle, Check, Pencil } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { FormField } from '@/components/ui/form-field'
import { PasswordStrength } from '@/components/ui/password-strength'
import { useI18n } from '@/i18n'
import { fetcher, apiPost } from '@/lib/fetcher'
import { getAuthToken, setAuthToken } from '@/lib/auth'

interface AuthMethods {
  password: { enabled: boolean }
  passkey: { enabled: boolean; count: number }
  github?: { enabled: boolean }
  oidc?: { enabled: boolean }
}

export function PasswordSettings() {
  const { t } = useI18n()
  const [toggling, setToggling] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Email change state
  const [newEmail, setNewEmail] = useState('')
  const [emailPassword, setEmailPassword] = useState('')
  const [emailSubmitting, setEmailSubmitting] = useState(false)

  // Editing state
  const [editingEmail, setEditingEmail] = useState(false)
  const [editingPassword, setEditingPassword] = useState(false)

  const { data: methods, mutate: mutateMethods } = useSWR<AuthMethods>('/api/auth/methods', fetcher)
  const { data: me, mutate: mutateMe } = useSWR<{ email: string }>('/api/me', (url: string) => {
    const token = getAuthToken()
    return fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} }).then(r => r.ok ? r.json() : Promise.reject())
  })

  const passwordEnabled = methods?.password?.enabled !== false
  const passkeyCount = methods?.passkey?.count ?? 0
  const githubEnabled = methods?.github?.enabled === true || methods?.oidc?.enabled === true
  const canDisablePassword = passkeyCount > 0 || githubEnabled
  const hasAlternativeAuth = passkeyCount > 0 || githubEnabled
  const currentPasswordRequired = !hasAlternativeAuth

  if (!methods) return null

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

  function cancelEmailEdit() {
    setEditingEmail(false)
    setNewEmail('')
    setEmailPassword('')
  }

  function cancelPasswordEdit() {
    setEditingPassword(false)
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
  }

  async function handleTogglePassword() {
    if (toggling) return
    const newEnabled = !passwordEnabled

    if (!newEnabled && !canDisablePassword) {
      showMessage(t('settings.cannotDisablePassword'), 'error')
      return
    }

    setToggling(true)
    try {
      await apiPost('/api/auth/password/toggle', { enabled: newEnabled })
      void mutateMethods()
    } catch (err: unknown) {
      showMessage(err instanceof Error ? err.message : t('settings.cannotDisablePassword'), 'error')
    } finally {
      setToggling(false)
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return

    if (newPassword.length < 8) {
      showMessage(t('settings.passwordTooShort'), 'error')
      return
    }
    if (newPassword !== confirmPassword) {
      showMessage(t('settings.passwordMismatch'), 'error')
      return
    }

    setSubmitting(true)
    try {
      const payload: { newPassword: string; currentPassword?: string } = { newPassword }
      if (currentPassword) {
        payload.currentPassword = currentPassword
      }
      const res = await apiPost('/api/auth/password/change', payload) as { ok: boolean; token: string }
      setAuthToken(res.token)
      cancelPasswordEdit()
      showMessage(t('settings.passwordChanged'), 'success')
    } catch (err: unknown) {
      showMessage(err instanceof Error ? err.message : t('settings.passwordChangeFailed'), 'error')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleChangeEmail(e: React.FormEvent) {
    e.preventDefault()
    if (emailSubmitting) return

    if (!newEmail || !newEmail.includes('@')) {
      showMessage(t('settings.emailChangeFailed'), 'error')
      return
    }

    setEmailSubmitting(true)
    try {
      const res = await apiPost('/api/auth/email/change', {
        newEmail,
        currentPassword: emailPassword,
      }) as { ok: boolean; token: string }
      setAuthToken(res.token)
      cancelEmailEdit()
      void mutateMe()
      showMessage(t('settings.emailChanged'), 'success')
    } catch (err: unknown) {
      showMessage(err instanceof Error ? err.message : t('settings.emailChangeFailed'), 'error')
    } finally {
      setEmailSubmitting(false)
    }
  }

  return (
    <>
      {/* Password auth toggle */}
      <section>
        <h2 className="text-base font-semibold text-text mb-4">{t('settings.passwordAuth')}</h2>
        <p className="text-xs text-muted mb-1">{t('settings.passwordAuthDesc')}</p>
        <p className="text-xs text-muted mb-3">{t('settings.passwordAuthHint')}</p>

        <label className="flex items-center gap-3 cursor-pointer">
          <button
            type="button"
            role="switch"
            aria-checked={passwordEnabled}
            onClick={handleTogglePassword}
            disabled={toggling || (passwordEnabled && !canDisablePassword)}
            className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${
              passwordEnabled ? 'bg-accent' : 'bg-border'
            } disabled:opacity-50`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                passwordEnabled ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
          <span className="text-sm text-text select-none">
            {passwordEnabled ? 'On' : 'Off'}
          </span>
        </label>

        {passwordEnabled && !canDisablePassword && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-muted">
            <AlertTriangle size={13} />
            {t('settings.cannotDisablePassword')}
          </p>
        )}
      </section>

      {/* Account credentials */}
      <section>
        <h2 className="text-base font-semibold text-text mb-4">{t('settings.accountCredentials')}</h2>

        <div className="space-y-2">
          {/* Email row */}
          <div className="rounded-lg border border-border bg-bg-card">
            <div className="flex items-center justify-between px-4 py-3">
              <div className="min-w-0">
                <p className="text-xs text-muted select-none">{t('settings.currentEmail')}</p>
                <p className="text-sm text-text truncate">{me?.email ?? '...'}</p>
              </div>
              {passwordEnabled && !editingEmail && (
                <button
                  type="button"
                  onClick={() => setEditingEmail(true)}
                  className="shrink-0 ml-4 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted rounded-md border border-border hover:bg-hover hover:text-text transition-colors select-none"
                >
                  <Pencil size={12} />
                  {t('settings.edit')}
                </button>
              )}
            </div>

            {editingEmail && (
              <form onSubmit={handleChangeEmail} className="border-t border-border px-4 py-3 space-y-3">
                <FormField label={t('settings.newEmail')} compact>
                  <Input
                    type="email"
                    value={newEmail}
                    onChange={e => setNewEmail(e.target.value)}
                    required
                    autoFocus
                  />
                </FormField>
                <FormField label={t('settings.passwordForEmailChange')} compact>
                  <Input
                    type="password"
                    value={emailPassword}
                    onChange={e => setEmailPassword(e.target.value)}
                    required
                  />
                </FormField>
                <div className="flex items-center gap-2">
                  <button
                    type="submit"
                    disabled={emailSubmitting || !newEmail || !emailPassword}
                    className="px-4 py-2 text-xs font-medium rounded-lg bg-accent text-accent-text hover:opacity-90 transition-opacity disabled:opacity-50 select-none"
                  >
                    {emailSubmitting ? '...' : t('settings.save')}
                  </button>
                  <button
                    type="button"
                    onClick={cancelEmailEdit}
                    className="px-4 py-2 text-xs font-medium rounded-lg border border-border text-muted hover:bg-hover hover:text-text transition-colors select-none"
                  >
                    {t('settings.cancel')}
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Password row */}
          <div className="rounded-lg border border-border bg-bg-card">
            <div className="flex items-center justify-between px-4 py-3">
              <div className="min-w-0">
                <p className="text-xs text-muted select-none">{t('settings.password')}</p>
                <p className="text-sm text-text tracking-widest">{'••••••••'}</p>
              </div>
              {passwordEnabled && !editingPassword && (
                <button
                  type="button"
                  onClick={() => setEditingPassword(true)}
                  className="shrink-0 ml-4 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted rounded-md border border-border hover:bg-hover hover:text-text transition-colors select-none"
                >
                  <Pencil size={12} />
                  {t('settings.edit')}
                </button>
              )}
            </div>

            {editingPassword && (
              <form onSubmit={handleChangePassword} className="border-t border-border px-4 py-3 space-y-3">
                {currentPasswordRequired && (
                  <FormField label={t('settings.currentPassword')} compact>
                    <Input
                      type="password"
                      autoComplete="current-password"
                      value={currentPassword}
                      onChange={e => setCurrentPassword(e.target.value)}
                      required
                      autoFocus
                    />
                  </FormField>
                )}
                <FormField label={t('settings.newPassword')} compact>
                  <Input
                    type="password"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    required
                    autoFocus={!currentPasswordRequired}
                  />
                  <PasswordStrength password={newPassword} />
                </FormField>
                <FormField label={t('settings.confirmPassword')} compact>
                  <div className="relative">
                    <Input
                      type="password"
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={e => setConfirmPassword(e.target.value)}
                      required
                    />
                    {confirmPassword && newPassword && confirmPassword === newPassword && (
                      <Check size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-accent" />
                    )}
                  </div>
                </FormField>
                <div className="flex items-center gap-2">
                  <button
                    type="submit"
                    disabled={submitting || !newPassword || !confirmPassword}
                    className="px-4 py-2 text-xs font-medium rounded-lg bg-accent text-accent-text hover:opacity-90 transition-opacity disabled:opacity-50 select-none"
                  >
                    {submitting ? '...' : t('settings.save')}
                  </button>
                  <button
                    type="button"
                    onClick={cancelPasswordEdit}
                    className="px-4 py-2 text-xs font-medium rounded-lg border border-border text-muted hover:bg-hover hover:text-text transition-colors select-none"
                  >
                    {t('settings.cancel')}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </section>

      {error && <p className="mt-3 text-sm text-error">{error}</p>}
      {success && <p className="mt-3 text-sm text-accent">{success}</p>}
    </>
  )
}
