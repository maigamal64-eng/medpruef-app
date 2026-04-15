"use client";

import { useEffect } from "react";
import { getCookieConsent } from "@/components/CookieBanner";

/**
 * Loads Google Analytics 4 and Microsoft Clarity ONLY after the user
 * has explicitly accepted cookies (ePrivacy Directive / Austrian TTDSG
 * compliance — the 2026-04-15 audit flagged this as a P0 legal issue).
 *
 * Before this component: both GA4 and Clarity were hard-coded in
 * `layout.tsx` via `<Script>` tags and loaded unconditionally on every
 * first paint. The CookieBanner existed in the repo but was never
 * mounted, so there was no consent mechanism at all.
 *
 * After: neither tracker loads until consent === "accepted". On
 * decline, nothing loads. On accept, scripts are injected immediately
 * into <head>. The banner broadcasts a `medpruef-consent` custom
 * event on click so this component reacts without a full page reload.
 */

const GA_ID = process.env.NEXT_PUBLIC_GA_ID;
const CLARITY_ID = process.env.NEXT_PUBLIC_CLARITY_ID;

function loadGA4() {
  if (!GA_ID) return;
  if (document.getElementById("ga-loader")) return; // already loaded
  const s1 = document.createElement("script");
  s1.id = "ga-loader";
  s1.async = true;
  s1.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
  document.head.appendChild(s1);

  const s2 = document.createElement("script");
  s2.id = "ga-init";
  s2.textContent =
    `window.dataLayer=window.dataLayer||[];` +
    `function gtag(){dataLayer.push(arguments);}` +
    `gtag('js',new Date());` +
    `gtag('config','${GA_ID}',{page_path:window.location.pathname});`;
  document.head.appendChild(s2);
}

function loadClarity() {
  if (!CLARITY_ID) return;
  if (document.getElementById("clarity-loader")) return;
  const s = document.createElement("script");
  s.id = "clarity-loader";
  s.textContent =
    `(function(c,l,a,r,i,t,y){` +
    `c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};` +
    `t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;` +
    `y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);` +
    `})(window,document,"clarity","script","${CLARITY_ID}");`;
  document.head.appendChild(s);
}

export default function ConsentGatedAnalytics() {
  useEffect(() => {
    const tryLoad = () => {
      if (getCookieConsent() !== "accepted") return;
      loadGA4();
      loadClarity();
    };

    tryLoad(); // on mount if already accepted (returning user)

    // React to the CookieBanner's accept click (broadcast via
    // CustomEvent so the banner doesn't need to know about this
    // component directly).
    const onConsent = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (detail === "accepted") {
        loadGA4();
        loadClarity();
      }
    };
    window.addEventListener("medpruef-consent", onConsent);
    return () => {
      window.removeEventListener("medpruef-consent", onConsent);
    };
  }, []);

  return null;
}
