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
export { BottomSheet, type BottomSheetProps, type BottomSheetPosition } from './BottomSheet'
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
