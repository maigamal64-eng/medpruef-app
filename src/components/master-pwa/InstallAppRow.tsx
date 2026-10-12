"use client";

/**
 * Settings "App installieren" row (LX-12, UX-ACC-46): makes a dismissed
 * install offer recoverable. Android and desktop Chrome get the browser's own
 * prompt (held by install-prompt.ts once PWAInstall captured it); iOS gets
 * the Share-sheet steps or, in an in-app browser, the "open in Safari" note;
 * an installed app says so. Renders nothing when there is nothing to offer.
 */
import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import IosInstallGuide from "@/components/master-pwa/IosInstallGuide";
import { isStandalone, readInstallEnv, resolveIosInstallState } from "@/lib/master-pwa/ios-install";
import {
  getDeferredInstallPrompt,
  promptInstall,
  subscribeInstallPrompt,
} from "@/lib/master-pwa/install-prompt";
import { pwaPlatform } from "@/lib/master-pwa/launch";
import { to } from "@/lib/i18n-offline";
import { trackEvent } from "@/lib/tracker";

type RowState = "hidden" | "ios" | "prompt" | "installed";

export default function InstallAppRow({ lang }: { lang: string }) {
  const [state, setState] = useState<RowState>("hidden");

  useEffect(() => {
    const decide = () => {
      const env = readInstallEnv();
      if (isStandalone(env)) return setState("installed");
      if (resolveIosInstallState(env) !== "not-ios") return setState("ios");
      setState(getDeferredInstallPrompt() ? "prompt" : "hidden");
    };
    decide();
    return subscribeInstallPrompt(decide);
  }, []);

  if (state === "hidden") return null;
  // The iOS guide is its own card with its own heading; no card around a card.
  if (state === "ios") {
    return <div className="mt-3" data-testid="install-app-row"><IosInstallGuide lang={lang} /></div>;
  }

  return (
    <div className="bg-[var(--mp-surface)] border border-[var(--mp-border-soft)] rounded-[var(--mp-r-card)] shadow-[var(--mp-shadow-card)] p-[18px] mt-3" data-testid="install-app-row">
      <h3 className="text-[15px] font-semibold text-[var(--mp-fg)] mb-2">{to("install_label", lang)}</h3>
      {state === "installed" && <p className="text-[13px] text-[var(--mp-fg-muted)]">{to("install_installed", lang)}</p>}
      {state === "prompt" && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <p className="text-[13px] text-[var(--mp-fg-muted)] flex-1">{to("install_android", lang)}</p>
          <button
            type="button"
            className="mp-btn mp-btn--primary w-full sm:w-auto min-h-11"
            onClick={async () => {
              const platform = pwaPlatform(readInstallEnv());
              trackEvent("pwa_install_clicked", { platform, surface: "settings" });
              if ((await promptInstall()) === "accepted") trackEvent("pwa_install_prompt_accepted", { platform });
            }}
          >
            <Download className="w-4 h-4" aria-hidden />
            {to("install_button", lang)}
          </button>
        </div>
      )}
    </div>
  );
}
