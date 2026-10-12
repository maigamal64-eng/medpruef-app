/**
 * MPDS v2 React primitive layer
 *
 * Central export for the MPDS primitives. Import from '@/components/ui'
 * rather than individual files:
 *
 *   import { Dialog, useToast, TextField, Alert, EmptyState } from '@/components/ui'
 *
 * Primitives exposed here wrap the `.mp-*` CSS classes in globals.css
 * with a11y-correct React behavior (focus trap, ARIA roles, keyboard
 * handling, reduced-motion respect).
 *
 * Canonical reference: design-system/components_v2.css +
 * design-system/MPDS-PICKS.md.
 */

export { Dialog, DialogFooter, type DialogProps } from './Dialog'
export { ToastProvider, useToast } from './Toast'
export { TextField, Textarea, Select, type TextFieldProps, type TextareaProps, type SelectProps } from './Field'
export { Alert } from './Alert'
export { EmptyState } from './EmptyState'
export { BrandedLoader } from './BrandedLoader'
export { Skeleton } from './Skeleton'
export { Switch } from './Switch'
export {
  AchievementRank,
  RANK_NAMES_BY_TIER,
  rankFromName,
  type RankTier,
} from './AchievementRank'

// ── B.1 primitive layer (2026-06-25) ──────────────────────────────────────
// These 10 primitives wrap existing .mp-* CSS classes. No surface imports
// them yet — adoption happens in B.2 (nav/layout), B.3 (question surfaces),
// and B.4 (login + thin surfaces).

export { Button, type ButtonProps, type ButtonVariant, type ButtonSize } from './Button'
export { Card, type CardProps } from './Card'
export { StatTile, type StatTileProps, type StatTileTrend } from './StatTile'
export { RankBadge, type RankBadgeProps } from './RankBadge'
export {
  Option,
  type OptionProps,
  type OptionState,
} from './Option'
export { AnswerReveal, type AnswerRevealProps } from './AnswerReveal'
export {
  RatingButton,
  type RatingButtonProps,
  type RatingIntensity,
} from './RatingButton'
export { NavItem, type NavItemProps } from './NavItem'
export { AppLayout, type AppLayoutProps } from './AppLayout'
export {
  ContextTabs,
  type ContextTabsProps,
  type ContextTab,
} from './ContextTabs'

// ── a11 UI primitives (2026-10-12): shell, overlays, status, images, results.
export { PageHeader, type PageHeaderProps } from './PageHeader'
export { LiveRegions } from './LiveRegions'
export { QuestionImage, type QuestionImageProps } from './QuestionImage'
export { ResultCard, type ResultCardProps, type ResultStatus } from './ResultCard'
export { StickyActionBar, type StickyActionBarProps } from './StickyActionBar'
export { optionStateFor, optionTagKey } from './Option'
export type { DialogPlacement, DialogKind } from './Dialog'
export type { AppLayoutMode } from './AppLayout'
export { ProPill } from './ProPill'
export { ConfirmAction, type ConfirmActionProps } from './ConfirmAction'
export { RatingRow, ratingLabel, type RatingName } from './RatingRow'
export { IconButton, type IconButtonProps } from './IconButton'
