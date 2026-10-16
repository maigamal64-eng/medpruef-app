"use client";

/**
 * CheckoutReturnReader (a-checkout-return-read): on the first in-app page after
 * the browser left for Whop, asks /api/checkout-return to record the return and,
 * when the page is /pricing, arms the one-tap reasons there. Renders nothing,
 * and sends nothing unless this browser wrote the hand-off marker in the last
 * 2 hours. The marker is consumed once the answer was used; a network failure or a
 * reload in between keeps it for the next page. /checkout/* is the way back from a payment, not an exit.
 */
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { authFetch } from "@/lib/authFetch";
import { armPricingPrompt, CHECKOUT_RETURN_READ_BUILD, clearCheckoutLeft, readCheckoutLeft } from "@/lib/checkout-return-marker";

export default function CheckoutReturnReader() {
  const pathname = usePathname() ?? "";
  const busy = useRef(false);

  useEffect(() => {
    if (!CHECKOUT_RETURN_READ_BUILD || busy.current) return;
    const left = readCheckoutLeft();
    if (!left) return;
    if (pathname.startsWith("/checkout")) { clearCheckoutLeft(); return; }
    busy.current = true;
    void (async () => {
      try {
        const r = await authFetch("/api/checkout-return", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ kind: "return", page: pathname }), skipAuthRedirect: true, timeoutMs: 8_000,
        });
        // A throttle, an outage or an unhydrated session keeps the marker for the next page (2 hours at most).
        if (r.status === 401 || r.status === 429 || r.status >= 500) return;
        if (!r.ok) { clearCheckoutLeft(); return; }
        const data = (await r.json().catch(() => null)) as { prompt?: boolean } | null;
        if (data?.prompt && (pathname === "/pricing" || pathname.startsWith("/pricing/"))) armPricingPrompt();
        // Consumed only after the answer was used: a reload in between (a first-load service worker
        // takeover) keeps the marker, and the server answers the repeat without a second row.
        clearCheckoutLeft();
      } catch {
        /* keep the marker: the next page retries until it is 2 hours old */
      } finally {
        busy.current = false;
      }
    })();
  }, [pathname]);

  return null;
}
