"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { pwaCopy, type PwaCopy } from "@/lib/master-pwa/copy";
import {
  iosInstallSteps,
  readInstallEnv,
  resolveIosInstallState,
  type InstallEnv,
} from "@/lib/master-pwa/ios-install";

interface Props {
  lang: string;
  /** Test seam; defaults to the live browser environment after mount. */
  env?: InstallEnv;
  onDismiss?: () => void;
}

/**
 * Add-to-Home-Screen guide for iOS, where no beforeinstallprompt exists.
 * Renders nothing outside iOS, so it can be mounted unconditionally.
 * Not wired anywhere yet: see handover/b36-pwa-support/wiring.md.
 */
export default function IosInstallGuide({ lang, env, onDismiss }: Props) {
  const [liveEnv, setLiveEnv] = useState<InstallEnv | null>(env ?? null);

  useEffect(() => {
    if (!env) setLiveEnv(readInstallEnv());
  }, [env]);

  if (!liveEnv) return null;
  const state = resolveIosInstallState(liveEnv);
  if (state === "not-ios") return null;

  const copy: PwaCopy = pwaCopy(lang);
  const steps = iosInstallSteps();

  return (
    <section
      data-testid="ios-install-guide"
      data-state={state}
      aria-label={copy.installTitle}
      className="rounded-2xl border p-4 text-sm"
      style={{ background: "var(--mp-surface-raised)", borderColor: "var(--mp-border)", color: "var(--mp-fg)" }}
    >
      <div className="flex items-start gap-3">
        <h2 className="flex-1 text-base font-semibold">
          {state === "installed"
            ? copy.installedTitle
            : state === "in-app-browser"
              ? copy.inAppTitle
              : copy.installTitle}
        </h2>
        {onDismiss && (
          <button type="button" onClick={onDismiss} aria-label={copy.dismiss} className="p-1">
            <X className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>
      {state === "installed" && <p className="mt-2">{copy.installedBody}</p>}
      {state === "in-app-browser" && <p className="mt-2">{copy.inAppBody}</p>}
      {state === "ready" && (
        <>
          <p className="mt-2">{copy.installIntro}</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            {steps.map((id) => (
              <li key={id}>{copy.steps[id]}</li>
            ))}
          </ol>
        </>
      )}
      <p className="mt-3 text-xs" style={{ color: "var(--mp-fg-muted)" }}>
        {copy.offlineHonesty}
      </p>
    </section>
  );
}
