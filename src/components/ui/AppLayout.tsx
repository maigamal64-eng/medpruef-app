'use client'

/**
 * AppLayout — MPDS v2 app shell primitive.
 *
 * Wraps the `.app-layout` + `.main-content` CSS classes from globals.css,
 * which handle the sidebar-left / content-right flex layout, responsive
 * sidebar hiding, and bottom-nav bottom-padding on mobile.
 *
 * This primitive does NOT own sidebar auto-hide logic (`return null` on
 * `/quiz` and `/exam`); that lives inside `<Sidebar>` itself and moves
 * to AppLayout only in B.2 if the team decides to centralize it.
 *
 * Usage:
 *   <AppLayout sidebar={<Sidebar ... />} bottomNav={<BottomNav ... />}>
 *     <main className="main-content ...">
 *       {children}
 *     </main>
 *   </AppLayout>
 *
 *   // Without explicit main wrapper (main-content class applied to children):
 *   <AppLayout sidebar={sidebar} bottomNav={nav}>
 *     <PageContent />
 *   </AppLayout>
 *
 * Layout rules (from globals.css):
 *   - `.app-layout`: flex, min-height: 100dvh
 *   - `.sidebar`: 260px, dark Oxford Blue, hidden below 1024px
 *   - `.main-content`: flex:1, min-width:0, padding-bottom:80px on mobile
 *
 * B.2 migration note: when each surface adds `<AppLayout>`, remove the
 * hand-rolled `<div className="app-layout">` wrapper at the call-site.
 * The auto-hide behavior (`sidebar === null` on /quiz / /exam) is currently
 * implemented inside Sidebar.tsx and continues to work transparently.
 */

export interface AppLayoutProps {
  /** The sidebar node — typically `<Sidebar lang={lang} ... />`. Pass null to omit. */
  sidebar?: React.ReactNode
  /** The bottom nav node — typically `<BottomNav lang={lang} />`. Pass null to omit. */
  bottomNav?: React.ReactNode
  /** Page content. Wrap in `<main className="main-content ...">` for full fidelity. */
  children: React.ReactNode
  className?: string
}

export function AppLayout({ sidebar, bottomNav, children, className }: AppLayoutProps) {
  return (
    <div
      className={['app-layout', className].filter(Boolean).join(' ')}
    >
      {sidebar}
      {children}
      {bottomNav}
    </div>
  )
}
