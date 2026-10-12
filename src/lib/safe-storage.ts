/** A blocked browser store must not block the current page's navigation. */
export function createSafeStorage(getStore: () => Storage) {
  const memory = new Map<string, string>();
  return {
    getItem(key: string): string | null {
      try { return getStore().getItem(key) ?? memory.get(key) ?? null; }
      catch { return memory.get(key) ?? null; }
    },
    setItem(key: string, value: string): boolean {
      memory.set(key, value);
      try { const store = getStore(); store.setItem(key, value); const persisted = store.getItem(key) === value; if (persisted) memory.delete(key); return persisted; }
      catch { return false; }
    },
    removeItem(key: string): void {
      memory.delete(key);
      try { getStore().removeItem(key); } catch { /* page memory is still cleared */ }
    },
  };
}
export const safeStorage = createSafeStorage(() => window.localStorage);
export const safeSessionStorage = createSafeStorage(() => window.sessionStorage);
