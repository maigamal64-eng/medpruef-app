"use client";
/**
 * The next step after the first 10 answers (a-activation-48h): the study
 * plan for the named sitting, or "When is your exam?" when none is named,
 * then the opt-in reminder for tomorrow. Shared by the quiz round end and
 * the Home card. No date is formatted here.
 */
import Link from "next/link";
import { CalendarCheck } from "lucide-react";
import { trackEvent } from "@/lib/tracker";
import { at } from "@/lib/activation/copy";
import type { ActivationView } from "@/lib/activation/useActivation";
import ActivationReminder from "./ActivationReminder";

export default function ActivationNext({ view, lang, source }: { view: ActivationView; lang: string; source: "quiz" | "home" }) {
  const exam = view.segment ?? "unknown";
  const named = view.named === true;
  return (
    <>
      <div className="flex items-start gap-2.5">
        <CalendarCheck className="w-4 h-4 mt-0.5 flex-shrink-0 text-[var(--mp-viridian)]" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-snug text-[var(--mp-fg)]">{at(named ? "win_plan_named" : "win_ask", lang)}</p>
          <Link
            href={named ? "/study-plan" : "/settings#exam-date"}
            onClick={() => trackEvent("activation_step", { step: named ? "plan_opened" : "ask_opened", exam, lang })}
            className="mp-btn mp-btn--secondary mt-2 min-h-11"
          >
            {at(named ? "win_plan_button" : "win_ask_button", lang)}
          </Link>
        </div>
      </div>
      {typeof view.reminder_hour === "number" && (
        <ActivationReminder lang={lang} hour={view.reminder_hour} exam={exam} source={source} />
      )}
    </>
  );
}
