"use client";

/**
 * Holds the browser's deferred install prompt (beforeinstallprompt, Chrome and
 * Android) so more than one surface can offer it: the PWAInstall banner and
 * the Settings "App installieren" row (UX-ACC-46). PWAInstall captures the
 * event and calls setDeferredInstallPrompt; anyone can subscribe.
 */

export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<(event: BeforeInstallPromptEvent | null) => void>();

export function setDeferredInstallPrompt(event: BeforeInstallPromptEvent | null): void {
  deferred = event;
  for (const listener of listeners) listener(deferred);
}

export function getDeferredInstallPrompt(): BeforeInstallPromptEvent | null {
  return deferred;
}

export function subscribeInstallPrompt(listener: (event: BeforeInstallPromptEvent | null) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Show the browser prompt once; the event cannot be reused afterwards. */
export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const event = deferred;
  if (!event) return "unavailable";
  try {
    await event.prompt();
    const choice = await event.userChoice;
    return choice.outcome;
  } catch {
    return "dismissed";
  } finally {
    setDeferredInstallPrompt(null);
  }
}
