'use client'
import { useEffect, useState } from 'react'
import { setFocusMode } from '@/lib/focus-mode'
import { t, useLang } from '@/lib/i18n'

/**
 * AppLayout — the app shell primitive (UX-GLOBAL-10).
 *
 * Modes:
 *   'standard' — Sidebar (desktop) and BottomNav (phone). The default.
 *   'focus'    — the running exam (and its review once the leave path
 *                exists): Sidebar, BottomNav, the feedback launcher and the
 *                global offline pill are NOT mounted (not just layered
 *                lower). The page owns one labelled exit and a reserved
 *                status row. Follows the visual viewport height.
 *   'public'   — visitors without a session: no learner Sidebar, no
 *                BottomNav, document scroll. The page renders the public
 *                header (PUB-02).
 *
 * /quiz and /flashcards stay 'standard' ([name]'s PRA-31 option B: an opaque
 * nav with the Next action above it).
 *
 * The skip link "Zum Inhalt" and the named navigation landmarks are built
 * here once (PRA-51). Pages render their own <main>.
 *
 * `variant` is the legacy name of `mode` ('default' = 'standard').
 */

export type AppLayoutMode = 'standard' | 'focus' | 'public'

export interface AppLayoutProps {
  mode?: AppLayoutMode
  /** @deprecated use `mode`. */
  variant?: 'default' | 'focus'
  /** The sidebar node — typically `<Sidebar lang={lang} ... />`. Pass null to omit. */
  sidebar?: React.ReactNode
  /** The bottom nav node — typically `<BottomNav lang={lang} />`. Pass null to omit. */
  bottomNav?: React.ReactNode
  /** Page content. Wrap in `<main className="main-content ...">` for full fidelity. */
  children: React.ReactNode
  className?: string
}

export function resolveLayoutMode(mode: AppLayoutMode | undefined, variant: AppLayoutProps['variant']): AppLayoutMode {
  if (mode) return mode
  return variant === 'focus' ? 'focus' : 'standard'
}

/** Which chrome each mode mounts. Pure: covered by the shell unit test. */
export function shellChrome(mode: AppLayoutMode): { sidebar: boolean; bottomNav: boolean; floatingChrome: boolean } {
  if (mode === 'focus') return { sidebar: false, bottomNav: false, floatingChrome: false }
  if (mode === 'public') return { sidebar: false, bottomNav: false, floatingChrome: true }
  return { sidebar: true, bottomNav: true, floatingChrome: true }
}

export function AppLayout({ mode, variant, sidebar, bottomNav, children, className }: AppLayoutProps) {
  const resolved = resolveLayoutMode(mode, variant)
  const chrome = shellChrome(resolved)
  const lang = useLang()
  const [viewportHeight, setViewportHeight] = useState<number | undefined>()
  useEffect(() => {
    if (resolved !== 'focus') return
    const viewport = window.visualViewport
    const resize = () => setViewportHeight(viewport?.height || window.innerHeight)
    resize(); viewport?.addEventListener('resize', resize); window.addEventListener('resize', resize)
    return () => { viewport?.removeEventListener('resize', resize); window.removeEventListener('resize', resize) }
  }, [resolved])
  useEffect(() => { setFocusMode(resolved === 'focus'); return () => setFocusMode(false) }, [resolved])

  const skipToMain = (e: React.MouseEvent<HTMLAnchorElement>) => {
    const main = document.querySelector('main')
    if (!main) return
    e.preventDefault()
    if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1')
    main.focus()
  }

  return (
    <div
      style={resolved === 'focus' && viewportHeight ? { height: viewportHeight } : undefined}
      data-shell-mode={resolved}
      className={[resolved === 'focus' ? 'mp-focus-layout' : 'app-layout', resolved === 'public' ? 'mp-public-layout' : '', className].filter(Boolean).join(' ')}
    >
      <a href="#main" className="mp-skip-link" onClick={skipToMain}>{t('a11_skip_to_content', lang)}</a>
      {chrome.sidebar && sidebar}
      {children}
      {chrome.bottomNav && bottomNav}
    </div>
  )
}
