"use client";

import { useState } from "react";
import { Alert } from "@/components/ui";
import { getStoredSession } from "@/lib/auth";
import { mentorT, type MentorUiLang } from "@/lib/i18n-mentor";
import { loadMentorApi } from "./client";

export default function RestingPackagesNotice({ lang }: { lang: MentorUiLang }) {
  const [email, setEmail] = useState(() => getStoredSession()?.user.email ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status === "saving" || status === "saved") return;
    setStatus("saving");
    const api = await loadMentorApi();
    const result = await api.waitlist(email);
    setStatus(result.ok ? "saved" : "error");
  };
  return (
    <Alert variant="info" className="mt-4">
      <p className="text-[13px] leading-relaxed">{mentorT("pkg_resting", lang)}</p>
      {status === "saved" ? <p role="status" className="mt-2 text-[13px]">{mentorT("pkg_waitlist_saved", lang)}</p> : (
        <form onSubmit={save} className="mt-3 flex flex-wrap items-end gap-2">
          <label className="min-w-0 flex-1 text-[13px]">
            {mentorT("pkg_waitlist_email", lang)}
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required maxLength={254} autoComplete="email" dir="ltr" className="mt-1 min-h-11 w-full rounded-lg border border-[var(--mp-border)] bg-[var(--mp-surface-raised)] px-3 text-[14px] text-[var(--mp-fg)]" />
          </label>
          <button type="submit" disabled={status === "saving"} className="mp-btn mp-btn--secondary min-h-11" aria-busy={status === "saving"}>{mentorT("pkg_waitlist", lang)}</button>
          {status === "error" && <p role="status" className="w-full text-[13px]">{mentorT("report_error", lang)}</p>}
        </form>
      )}
    </Alert>
  );
}
