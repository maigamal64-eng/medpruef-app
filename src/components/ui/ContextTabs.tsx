'use client'

/**
 * ContextTabs — MPDS v2 tabbed context panel primitive.
 *
 * Two visual variants:
 *
 *   variant="underline" (default)
 *     The border-bottom active style used in QuestionCard's Quiz-B panel.
 *     Reproduces the live class chain exactly so B.3 migration is zero visual diff.
 *     Tab panel area is managed by the caller (children slot for active panel).
 *
 *   variant="pill"
 *     Wraps `.mp-tabs` + `.mp-tabs__tab` from globals.css — the raised pill
 *     container. Use for secondary navigation (e.g. progress page sub-sections)
 *     where the pill look is appropriate.
 *
 * IMPORTANT: `variant="underline"` does NOT use `.mp-tabs` CSS. The live Quiz-B
 * tabs are underline-style, not pill — wrapping `.mp-tabs` in B.3 would be a
 * deliberate visual change. The B.3 lead should decide which variant to use
 * per surface at migration time.
 *
 * Usage (underline — QuestionCard):
 *   type TabId = "erklaerung" | "ki" | "notizen" | "uebersetzen" | "quelle"
 *
 *   <ContextTabs
 *     tabs={[
 *       { id: "erklaerung", label: "Erklärung", icon: <Lightbulb className="w-3.5 h-3.5" /> },
 *       { id: "ki", label: "KI-Erklärung", icon: <Bot className="w-3.5 h-3.5" />, isAction: true },
 *       { id: "notizen", label: "Notizen", icon: <FileText className="w-3.5 h-3.5" /> },
 *     ]}
 *     activeTab="erklaerung"
 *     onTabChange={(id) => setActiveTab(id)}
 *     onTabAction={(id) => { if (id === "ki") openAIChat() }}
 *     ariaLabel="Zusatzinformationen"
 *   >
 *     <div>{tabPanelContent}</div>
 *   </ContextTabs>
 *
 * Usage (pill):
 *   <ContextTabs
 *     variant="pill"
 *     tabs={[{ id: "stats", label: "Statistiken" }, { id: "topics", label: "Themen" }]}
 *     activeTab={activeSection}
 *     onTabChange={setActiveSection}
 *   >
 *     {panelContent}
 *   </ContextTabs>
 *
 * A11y (both variants):
 *   - role="tablist" on the tab bar
 *   - role="tab" + aria-selected on each tab
 *   - role="tabpanel" on the panel area (caller must provide id for aria-controls)
 *   - Arrow-key navigation (Left / Right / Home / End)
 *   - isAction tabs do NOT receive aria-controls (they open a modal, not a panel)
 */

import { useRef, useId } from 'react'

export interface ContextTab<TId extends string = string> {
  id: TId
  label: string
  icon?: React.ReactNode
  /**
   * Action tabs trigger a callback (e.g. open a modal) instead of switching
   * the active panel. They receive aria-selected="false" and no aria-controls.
   */
  isAction?: boolean
  /** Tooltip / aria hint shown on hover. */
  hint?: string
}

export interface ContextTabsProps<TId extends string = string> {
  tabs: ContextTab<TId>[]
  activeTab: TId
  /** Called with the tab id when a non-action tab is clicked. */
  onTabChange: (id: TId) => void
  /** Called with the tab id when an isAction tab is clicked. */
  onTabAction?: (id: TId) => void
  /** Visual style. Defaults to "underline" (Quiz-B live style). */
  variant?: 'underline' | 'pill'
  /** aria-label for the tablist. */
  ariaLabel?: string
  /** Tab panel content (the active panel). Caller manages what to render. */
  children?: React.ReactNode
  className?: string
}

export function ContextTabs<TId extends string = string>({
  tabs,
  activeTab,
  onTabChange,
  onTabAction,
  variant = 'underline',
  ariaLabel,
  children,
  className,
}: ContextTabsProps<TId>) {
  const baseId = useId()
  const tabRefs = useRef<Partial<Record<string, HTMLButtonElement | null>>>({})

  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLButtonElement>,
    idx: number,
  ) => {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return
    e.preventDefault()
    let nextIdx = idx
    if (e.key === 'ArrowRight') nextIdx = (idx + 1) % tabs.length
    else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + tabs.length) % tabs.length
    else if (e.key === 'Home') nextIdx = 0
    else if (e.key === 'End') nextIdx = tabs.length - 1
    const next = tabs[nextIdx]
    if (!next) return
    if (!next.isAction) onTabChange(next.id)
    tabRefs.current[next.id]?.focus()
  }

  if (variant === 'pill') {
    return (
      <div className={className}>
        <div className="mp-tabs" role="tablist" aria-label={ariaLabel}>
          {tabs.map((tab, idx) => {
            const isActive = !tab.isAction && activeTab === tab.id
            return (
              <button
                key={tab.id}
                ref={(el) => { tabRefs.current[tab.id] = el }}
                role="tab"
                type="button"
                id={`${baseId}-tab-${tab.id}`}
                aria-selected={isActive}
                aria-controls={tab.isAction ? undefined : `${baseId}-panel-${tab.id}`}
                tabIndex={isActive ? 0 : -1}
                title={tab.hint}
                onClick={() => {
                  if (tab.isAction) onTabAction?.(tab.id)
                  else onTabChange(tab.id)
                }}
                onKeyDown={(e) => handleKeyDown(e, idx)}
                className={['mp-tabs__tab', isActive ? 'mp-tabs__tab--active' : ''].filter(Boolean).join(' ')}
              >
                {tab.icon && <span aria-hidden>{tab.icon}</span>}
                {tab.label}
              </button>
            )
          })}
        </div>
        {children && (
          <div
            role="tabpanel"
            id={`${baseId}-panel-${activeTab}`}
            aria-labelledby={`${baseId}-tab-${activeTab}`}
          >
            {children}
          </div>
        )}
      </div>
    )
  }

  // variant === 'underline' — reproduces the live Quiz-B tab bar from QuestionCard.tsx
  return (
    <div className={className}>
      <div
        role="tablist"
        aria-label={ariaLabel}
        className="flex items-stretch gap-1 overflow-x-auto border-b border-[var(--mp-border)] -mx-1 px-1"
        style={{ scrollbarWidth: 'thin' } as React.CSSProperties}
      >
        {tabs.map((tab, idx) => {
          const isActive = !tab.isAction && activeTab === tab.id
          return (
            <button
              key={tab.id}
              ref={(el) => { tabRefs.current[tab.id] = el }}
              role="tab"
              type="button"
              id={`${baseId}-tab-${tab.id}`}
              aria-selected={isActive}
              aria-controls={tab.isAction ? undefined : `${baseId}-panel-${tab.id}`}
              tabIndex={isActive ? 0 : -1}
              title={tab.hint}
              onClick={() => {
                if (tab.isAction) onTabAction?.(tab.id)
                else onTabChange(tab.id)
              }}
              onKeyDown={(e) => handleKeyDown(e, idx)}
              className={[
                // UX-PRA-29: under 480 px the tabs are equal segments, icon over
                // a 13 px label, at least 44 px tall; wider screens keep a row.
                'flex flex-1 min-[480px]:flex-none flex-col min-[480px]:flex-row items-center justify-center gap-0.5 min-[480px]:gap-1.5 min-h-11 px-2 min-[480px]:px-3 py-1.5 min-[480px]:py-2.5 text-[13px] min-[480px]:text-xs whitespace-nowrap border-b-2 transition-colors',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mp-viridian)]/40 focus-visible:rounded-t',
                isActive
                  ? 'text-[var(--mp-fg)] font-bold border-b-[var(--mp-viridian)]'
                  : 'text-[var(--mp-fg-muted)] font-semibold border-b-transparent hover:text-[var(--mp-fg)]',
              ].join(' ')}
            >
              {tab.icon && <span aria-hidden>{tab.icon}</span>}
              {tab.label}
            </button>
          )
        })}
      </div>
      {children && (
        <div
          role="tabpanel"
          id={`${baseId}-panel-${activeTab}`}
          aria-labelledby={`${baseId}-tab-${activeTab}`}
        >
          {children}
        </div>
      )}
    </div>
  )
}
