import { ShieldAlert } from 'lucide-react'
import { Callout } from '@/components/ui/callout'
import { useI18n } from '@/i18n'

/** Mirrors BLOCKED_ERROR_PREFIX in server/fetcher/content.ts */
const BLOCKED_ERROR_PREFIX = 'blocked:'

function isRedditUrl(url: string): boolean {
  try {
    return /(^|\.)reddit\.com$/.test(new URL(url).hostname)
  } catch {
    return false
  }
}

interface Props {
  lastError: string | null | undefined
  url: string
}

/** Warns the reader that the site served a block page instead of the article. */
export function ArticleBlockedBanner({ lastError, url }: Props) {
  const { t } = useI18n()
  if (!lastError?.startsWith(BLOCKED_ERROR_PREFIX)) return null

  return (
    <Callout variant="error">
      <div className="flex items-start gap-2 text-sm text-text">
        <ShieldAlert size={16} className="text-error mt-0.5 shrink-0" />
        <div>
          <p>{t('article.blockedBySite')}</p>
          {isRedditUrl(url) && <p className="mt-1 text-muted">{t('article.blockedRedditHint')}</p>}
        </div>
      </div>
    </Callout>
  )
}
