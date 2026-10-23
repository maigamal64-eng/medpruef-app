"use client";

/**
 * The learner's one general support entry: the Intercom Support-Chat
 * (a-intercom-finalize-1023). It replaced the first-party feedback form
 * (FeedbackWidget, retired 23 Oct 2026). The in-quiz "Problem melden" flag
 * (/api/suggestions) and the /api/feedback route for the other cards stay.
 *
 * "Feedback und Hilfe" in the Mehr sheet and the Sidebar, and the Library's
 * own-note report, dispatch OPEN_SUPPORT_EVENT; IntercomMessenger listens and
 * opens the Messenger. The entries show only while the chat can open: the
 * Messenger flag is on AND the learner holds a signed session (the identify
 * route answers 401 otherwise), so no entry is ever a dead click.
 */

import { useEffect, useState } from "react";
import { getSessionToken } from "@/lib/auth";

export const OPEN_SUPPORT_EVENT = "medpruef:open-support";

/** Build-time Messenger flag (inlined by Next for the client bundle). */
export function supportChatEnabled(): boolean {
  return process.env.NEXT_PUBLIC_MEDPRUF_INTERCOM_ENABLED === "true";
}

/** Ask IntercomMessenger to open the Messenger. */
export function openSupportChat(): void {
  window.dispatchEvent(new CustomEvent(OPEN_SUPPORT_EVENT));
}

/**
 * True while the Support-Chat can open for this tab. Read in an effect (never
 * at render) so server and first client render agree.
 */
export function useSupportChatAvailable(): boolean {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    const sync = () => setSignedIn(Boolean(getSessionToken()));
    sync();
    window.addEventListener("medpruef:session-changed", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("medpruef:session-changed", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return supportChatEnabled() && signedIn;
}
