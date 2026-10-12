'use client'

/**
 * PageHeader — one header row for every in-app route (UX-GLOBAL-10).
 *
 * Title rendered once, 22 px on phones and 28 px on desktop, weight 800.
 * Optional subtitle (name the active exam with its short label), optional
 * back IconButton (44 px, one goBack() order) and one optional trailing slot
 * (on money screens: the "Hilfe zu Zahlung oder Zugang" control). Theme and
 * language never sit in page headers.
 */

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { t, useLang } from '@/lib/i18n'
import { goBack, previousInAppPath, resolveBack, type BackTarget } from '@/lib/go-back'
import { getStoredSession } from '@/lib/auth'

export interface PageHeaderProps {
  title: string
  subtitle?: React.ReactNode
  /** Show the back control. */
  back?: boolean
  /** One trailing control. */
  trailing?: React.ReactNode
  /** id for the h1, e.g. for aria-labelledby on the page region. */
  titleId?: string
  className?: string
}

export function PageHeader({ title, subtitle, back = false, trailing, titleId, className }: PageHeaderProps) {
  const lang = useLang()
  const router = useRouter()
  const [target, setTarget] = useState<BackTarget | null>(null)

  useEffect(() => {
    if (!back) return
    const pathname = window.location.pathname
    setTarget(resolveBack({
      pathname,
      search: window.location.search,
      previousInAppPath: previousInAppPath(pathname),
      hasSession: !!getStoredSession()?.user?.id,
    }))
  }, [back])

  const label = target ? t(target.labelKey === 'home' ? 'a11_back_home' : 'a11_back', lang) : t('a11_back', lang)

  return (
    <header className={['mp-page-header', className].filter(Boolean).join(' ')}>
      {back && (
        <button
          type="button"
          className="mp-icon-btn -ml-2 flex-shrink-0"
          aria-label={label}
          title={label}
          onClick={() => goBack(router, !!getStoredSession()?.user?.id)}
        >
          <ArrowLeft className="w-5 h-5" aria-hidden />
        </button>
      )}
      <div className="flex-1 min-w-0">
        <h1 id={titleId} className="mp-page-header__title">{title}</h1>
        {subtitle && <p className="mp-page-header__subtitle">{subtitle}</p>}
      </div>
      {trailing && <div className="flex-shrink-0">{trailing}</div>}
    </header>
  )
}
