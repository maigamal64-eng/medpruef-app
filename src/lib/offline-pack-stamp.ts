/**
 * The paid-pack access stamp key, in a module with no IndexedDB or Cache API
 * code, so useUserTier (mounted on every learner page) can check for a pack
 * without loading the downloader. Accounts without a stamp cause no extra
 * request: offline-pack.ts is imported only when the stamp exists.
 */
import { safeStorage } from "./safe-storage";

/** { accessUntil: ISO | null } of the paid access that allowed the stored pack. */
export const OFFLINE_ACCESS_KEY = "medpruef_offline_access";

export function hasPackAccessStamp(): boolean {
  return safeStorage.getItem(OFFLINE_ACCESS_KEY) !== null;
}
