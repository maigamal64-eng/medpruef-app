/**
 * Toast queue rules (UX-GLOBAL-15, ACC-43). Pure so the cap and the keyed
 * replace are unit-tested without a DOM.
 */

export interface ToastRecord {
  id: number
  key?: string
  variant: 'success' | 'error' | 'warning' | 'info'
  title: string
}

export const TOAST_CAP = 3

/**
 * Add a toast: a toast with the same key replaces the old one in place;
 * beyond the cap the oldest non-error is dropped first (errors only when
 * every visible toast is an error).
 */
export function pushToast<T extends ToastRecord>(current: readonly T[], next: T, cap = TOAST_CAP): T[] {
  const keyed = next.key ? current.findIndex((item) => item.key === next.key) : -1
  let list: T[]
  if (keyed >= 0) {
    list = current.slice()
    list[keyed] = next
    return list
  }
  list = [...current, next]
  while (list.length > cap) {
    const dropIndex = list.findIndex((item, index) => item.variant !== 'error' && index < list.length - 1)
    list.splice(dropIndex >= 0 ? dropIndex : 0, 1)
  }
  return list
}
