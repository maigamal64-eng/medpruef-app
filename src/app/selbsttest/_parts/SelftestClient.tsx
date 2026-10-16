"use client";

/**
 * The self-check flow: choose the bank, a timed run of the allowlisted
 * questions (one at a time, strict multi-answer grading), then the result
 * (SelftestResult). Nothing is stored or sent until the visitor saves; the
 * anonymous funnel only sees start, finish (a score band) and the save tap.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Clock } from "lucide-react";
import { Option, optionStateFor } from "@/components/ui/Option";
import { getUiLang, renderLang, setLang } from "@/lib/i18n";
import { trackFunnelEvent } from "@/lib/funnel-events";
import { wallClockRemaining } from "@/lib/practice-exam-state";
import { SELFTEST_BANKS, scoreBucket, scoreSelftest, type SelftestBank, type SelftestItem, type SelftestPayload } from "@/lib/public-selftest";
import { fieldLabel, selftestCopy, type SelftestLang } from "@/lib/public-selftest/copy";
import SelftestResult, { type FinishedRun } from "./SelftestResult";

const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];

function shuffled<T>(list: readonly T[]): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function clock(seconds: number): string {
  const s = Math.max(0, seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

type Phase = { kind: "intro" } | { kind: "loading" } | { kind: "error" } | { kind: "run"; payload: SelftestPayload; items: SelftestItem[] } | { kind: "result"; run: FinishedRun };

export default function SelftestClient({ lang, explicitLang, initialBank, bankLabels, source }: {
  lang: SelftestLang;
  explicitLang: boolean;
  initialBank: SelftestBank | null;
  bankLabels: Record<SelftestBank, string>;
  source: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [bank, setBank] = useState<SelftestBank | null>(initialBank);
  const [phase, setPhase] = useState<Phase>({ kind: "intro" });

  // ?lang only becomes a stored choice when it changes what the reader sees (same rule as the calendar pages).
  useEffect(() => {
    if (explicitLang) { if (renderLang(getUiLang()) !== lang) setLang(lang); }
    else if (getUiLang() !== "de") {
      const p = new URLSearchParams(window.location.search);
      p.set("lang", "en");
      router.replace(`${pathname}?${p}`, { scroll: false });
    }
  }, [lang, explicitLang, router, pathname]);

  const start = useCallback(async () => {
    if (!bank) return;
    setPhase({ kind: "loading" });
    try {
      const res = await fetch(`/api/selftest?bank=${bank}`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const payload = (await res.json()) as SelftestPayload;
      if (!payload || !Array.isArray(payload.items) || payload.items.length === 0) throw new Error("empty");
      const items = payload.items.map((it) => ({ ...it, options: shuffled(it.options) }));
      setPhase({ kind: "run", payload, items });
      trackFunnelEvent("selftest_start", { exam: bank, source });
    } catch {
      setPhase({ kind: "error" });
    }
  }, [bank, source]);

  if (phase.kind === "run") {
    return (
      <RunView
        lang={lang}
        payload={phase.payload}
        items={phase.items}
        onFinish={(run) => {
          setPhase({ kind: "result", run });
          trackFunnelEvent("selftest_finish", { exam: run.bank, bucket: scoreBucket(run.score.correct, run.score.total), source });
          requestAnimationFrame(() => document.getElementById("selftest-result-title")?.focus());
        }}
      />
    );
  }
  if (phase.kind === "result") {
    return <SelftestResult lang={lang} run={phase.run} source={source} onRestart={() => setPhase({ kind: "intro" })} />;
  }

  return (
    <section className="mp-card min-w-0 space-y-5 p-5 sm:p-6" aria-labelledby="selftest-bank-title" data-testid="selftest-intro">
      <fieldset className="space-y-2.5">
        <legend id="selftest-bank-title" className="mb-2 text-lg font-bold">{selftestCopy("bank_label", lang)}</legend>
        {SELFTEST_BANKS.map((b) => (
          <label key={b} className={`flex min-h-[52px] cursor-pointer items-center gap-3 rounded-xl border-2 p-3.5 ${bank === b ? "border-[var(--mp-viridian)] bg-[var(--mp-viridian)]/5" : "border-[var(--mp-border)]"}`}>
            <input type="radio" name="selftest-bank" value={b} checked={bank === b} onChange={() => setBank(b)} className="size-4 accent-[var(--mp-viridian)]" data-testid={`selftest-bank-${b}`} />
            <span className="font-semibold">{bankLabels[b]}</span>
          </label>
        ))}
      </fieldset>
      <p className="text-[13px] leading-relaxed text-[var(--mp-fg-muted)]" data-testid="selftest-scope">{selftestCopy("scope", lang)}</p>
      {phase.kind === "error" && (
        <div role="alert" className="rounded-xl border border-[var(--mp-border)] bg-[var(--mp-surface-sunken)] p-4" data-testid="selftest-error">
          <p className="font-semibold">{selftestCopy("error_title", lang)}</p>
          <p className="mt-1 text-sm text-[var(--mp-fg-muted)]">{selftestCopy("error_body", lang)}</p>
        </div>
      )}
      <button
        type="button"
        className="mp-btn mp-btn--primary min-h-11 w-full sm:w-auto"
        disabled={!bank || phase.kind === "loading"}
        aria-busy={phase.kind === "loading" || undefined}
        onClick={start}
        data-testid="selftest-start"
      >
        {phase.kind === "loading" ? selftestCopy("loading", lang) : phase.kind === "error" ? selftestCopy("retry", lang) : selftestCopy("start", lang)}
      </button>
    </section>
  );
}

function RunView({ lang, payload, items, onFinish }: { lang: SelftestLang; payload: SelftestPayload; items: SelftestItem[]; onFinish: (run: FinishedRun) => void }) {
  const [index, setIndex] = useState(0);
  const [selections, setSelections] = useState<Record<number, number[]>>({});
  const [confirming, setConfirming] = useState(false);
  const startedAt = useRef(Date.now());
  const [left, setLeft] = useState(payload.durationS);
  const spent = useRef<Record<number, number>>({});
  const shownAt = useRef(Date.now());
  const finished = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const item = items[index];

  const account = useCallback(() => {
    const now = Date.now();
    const id = items[index]?.id;
    if (id !== undefined) spent.current[id] = (spent.current[id] ?? 0) + (now - shownAt.current);
    shownAt.current = now;
  }, [items, index]);

  const finish = useCallback((timedOut: boolean) => {
    if (finished.current) return;
    finished.current = true;
    account();
    onFinish({ bank: payload.bank, items, selections, spentMs: { ...spent.current }, timedOut, score: scoreSelftest(items, selections) });
  }, [account, items, onFinish, payload.bank, selections]);

  useEffect(() => {
    const tick = () => {
      setLeft((prev) => {
        const next = wallClockRemaining(startedAt.current, payload.durationS, Date.now(), prev);
        return next;
      });
    };
    const id = window.setInterval(tick, 1000);
    document.addEventListener("visibilitychange", tick);
    return () => { window.clearInterval(id); document.removeEventListener("visibilitychange", tick); };
  }, [payload.durationS]);

  useEffect(() => { if (left <= 0) finish(true); }, [left, finish]);

  const go = (to: number) => {
    account();
    setConfirming(false);
    setIndex(to);
    requestAnimationFrame(() => headingRef.current?.focus());
  };

  const pick = (i: number) => {
    setSelections((prev) => {
      const current = prev[item.id] ?? [];
      const next = item.required > 1 ? (current.includes(i) ? current.filter((x) => x !== i) : [...current, i]) : current[0] === i ? [] : [i];
      const out = { ...prev };
      if (next.length) out[item.id] = next; else delete out[item.id];
      return out;
    });
  };

  const open = useMemo(() => items.filter((it) => !(selections[it.id]?.length)).length, [items, selections]);
  const last = index === items.length - 1;
  const chosen = selections[item.id] ?? [];

  return (
    <section className="min-w-0 space-y-4" aria-labelledby="selftest-q-title" data-testid="selftest-run">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="font-semibold" data-testid="selftest-progress">{selftestCopy("progress", lang, { i: index + 1, n: items.length })}</span>
        <span className={`inline-flex items-center gap-1.5 font-mono ${left <= 60 ? "text-[var(--mp-warning-text,var(--mp-fg))] font-bold" : "text-[var(--mp-fg-muted)]"}`} data-testid="selftest-timer">
          <Clock className="size-4" aria-hidden />
          {selftestCopy("time_left", lang, { time: clock(left) })}
        </span>
      </div>
      <ol className="flex flex-wrap gap-1.5" aria-label={selftestCopy("map_label", lang)}>
        {items.map((it, i) => (
          <li key={it.id}>
            <button
              type="button"
              onClick={() => go(i)}
              aria-current={i === index ? "step" : undefined}
              aria-label={selftestCopy(selections[it.id]?.length ? "map_item_answered" : "map_item_open", lang, { i: i + 1, n: items.length })}
              className={`size-11 rounded-lg border text-sm font-semibold ${i === index ? "border-[var(--mp-viridian)] border-2" : "border-[var(--mp-border)]"} ${selections[it.id]?.length ? "bg-[var(--mp-tint-viridian)]" : "bg-[var(--mp-surface-raised)]"}`}
            >
              {i + 1}
            </button>
          </li>
        ))}
      </ol>
      <article className="mp-card min-w-0 space-y-4 p-5 sm:p-6">
        <p className="text-[13px] font-semibold text-[var(--mp-fg-muted)]">{selftestCopy("field", lang, { field: fieldLabel(item.field, lang) })}</p>
        <h2 id="selftest-q-title" ref={headingRef} tabIndex={-1} lang="de" className="text-lg font-semibold leading-snug outline-none [overflow-wrap:anywhere]">{item.question}</h2>
        <p className="text-[13px] text-[var(--mp-fg-muted)]">{item.required > 1 ? selftestCopy("multi_hint", lang, { n: item.required }) : selftestCopy("single_hint", lang)}</p>
        <div role="group" aria-labelledby="selftest-q-title" className="space-y-2.5" lang="de">
          {item.options.map((o, i) => (
            <Option
              key={`${item.id}-${i}`}
              letter={LETTERS[i]}
              multiSelect={item.required > 1}
              checked={chosen.includes(i)}
              state={optionStateFor({ answered: false, selected: chosen.includes(i), correct: o.correct })}
              onClick={() => pick(i)}
              className="[overflow-wrap:anywhere]"
            >
              {o.text}
            </Option>
          ))}
        </div>
      </article>
      {confirming && (
        <div role="alert" className="rounded-xl border border-[var(--mp-border)] bg-[var(--mp-surface-sunken)] p-4 space-y-3" data-testid="selftest-confirm">
          <p className="text-sm">{selftestCopy("finish_open", lang, { k: open })}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="mp-btn mp-btn--primary min-h-11" onClick={() => finish(false)} data-testid="selftest-finish-anyway">{selftestCopy("finish_confirm", lang)}</button>
            <button type="button" className="mp-btn mp-btn--secondary min-h-11" onClick={() => setConfirming(false)}>{selftestCopy("keep_going", lang)}</button>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" className="mp-btn mp-btn--secondary min-h-11" disabled={index === 0} onClick={() => go(index - 1)} data-testid="selftest-back">{selftestCopy("back", lang)}</button>
        <div className="flex flex-wrap gap-2">
          {!last && <button type="button" className="mp-btn mp-btn--secondary min-h-11" onClick={() => (open > 0 ? setConfirming(true) : finish(false))} data-testid="selftest-finish-early">{selftestCopy("finish", lang)}</button>}
          {last
            ? <button type="button" className="mp-btn mp-btn--primary min-h-11" onClick={() => (open > 0 ? setConfirming(true) : finish(false))} data-testid="selftest-finish">{selftestCopy("finish", lang)}</button>
            : <button type="button" className="mp-btn mp-btn--primary min-h-11" onClick={() => go(index + 1)} data-testid="selftest-next">{selftestCopy("next", lang)}</button>}
        </div>
      </div>
    </section>
  );
}
