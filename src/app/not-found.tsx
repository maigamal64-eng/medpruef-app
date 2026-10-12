/**
 * not-found.tsx: branded, recovery-first 404 (UX-PUB-37).
 *
 * One language per render (NotFoundBody reads the visitor's language after
 * mount; the static HTML is German), one full-width way back, and quiet text
 * links. No quiz or search buttons: for a visitor without an account both
 * only lead to the login.
 */

import NotFoundBody from "@/components/NotFoundBody";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-[var(--mp-surface-sunken)] flex items-center justify-center p-4">
      <NotFoundBody />
    </div>
  );
}
