"use client";

export const OFFLINE_PERSIST_KEY = "medpruef_offline_persistence";
export interface OfflinePersistenceResult {
  status: "granted" | "denied" | "unsupported" | "error";
  checked_at: string;
}
let pending: Promise<OfflinePersistenceResult> | null = null;

/** Call from a user-initiated offline download; never throw or promise retention. */
export function requestOfflinePersistence(): Promise<OfflinePersistenceResult> {
  if (pending) return pending;
  const run = async (): Promise<OfflinePersistenceResult> => {
    let status: OfflinePersistenceResult["status"] = "unsupported";
    try {
      if (typeof navigator !== "undefined" && navigator.storage?.persist) {
        const already = navigator.storage.persisted ? await navigator.storage.persisted() : false;
        status = already || await navigator.storage.persist() ? "granted" : "denied";
      }
    } catch { status = "error"; }
    const result = { status, checked_at: new Date().toISOString() };
    try { if (typeof window !== "undefined") window.localStorage.setItem(OFFLINE_PERSIST_KEY, JSON.stringify(result)); } catch { /* Private mode or quota denial must not block downloads. */ }
    return result;
  };
  pending = run();
  const active = pending;
  void active.finally(() => { if (pending === active) pending = null; });
  return active;
}
