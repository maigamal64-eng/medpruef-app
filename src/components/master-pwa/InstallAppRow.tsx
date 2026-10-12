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

  return (
    <div className="set-card mt-3" style={{ padding: 18 }} data-testid="install-app-row">
      <h3 className="sr-title mb-2">{to("install_label", lang)}</h3>
      {state === "installed" && <p className="sr-sub">{to("install_installed", lang)}</p>}
      {state === "ios" && <IosInstallGuide lang={lang} />}
      {state === "prompt" && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <p className="sr-sub flex-1">{to("install_android", lang)}</p>
          <button
            type="button"
            className="mp-btn mp-btn--primary w-full sm:w-auto min-h-11"
            onClick={async () => {
              const platform = pwaPlatform(readInstallEnv());
              trackEvent("pwa_install_clicked", { platform, surface: "settings" });
              await promptInstall();
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
