"use client";

/**
 * /history list (a24): saved exams for every signed-in learner (pick-ux-exm-38
 * B: free and lapsed accounts get a read-only list of dates and scores, the
 * question-by-question review stays Pro). The server decides: rows link to
 * the detail only when GET /api/history/exams answered `access: "full"`.
 *
 * States (UX-EXM-37): loading skeleton, error with retry (stale rows stay
 * visible with an error bar), truthful empty state. The list stays cached in
 * memory per account so Back from a detail is instant, and tab and scroll are
 * restored from sessionStorage (UX-EXM-36).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { History as HistoryIcon } from "lucide-react";
import { Alert, EmptyState, PageHeader, Skeleton } from "@/components/ui";
import { authFetch } from "@/lib/authFetch";
import { getStoredSession } from "@/lib/auth";
import { loadPendingExams } from "@/lib/examSession";
import { useLang } from "@/lib/i18n";
import { th } from "@/lib/i18n-history";
import { useSignedInRoute } from "@/lib/hooks/useSignedInRoute";
import { useUserTier } from "@/lib/hooks/useUserTier";
import ExamRow from "./ExamRow";
import OverviewStrip, { type QuizStats } from "./OverviewStrip";
import QuestionsTab from "./QuestionsTab";
import TrendChart from "./TrendChart";
import {
  groupRows,
  legacyDetailHref,
  overviewOf,
  pickTrend,
  readListState,
  writeListState,
  type AttemptRow,
  type ListAccess,
  type RunGroup,
} from "./history-rules";

const PAGE = 50;

interface ListCache {
  account: string;
  rows: AttemptRow[];
  total: number | null;
  access: ListAccess;
}
/** In-memory list cache for an instant Back from a detail (EXM-36). */
let listCache: ListCache | null = null;

const GROUP_KEY: Record<RunGroup, "group_full" | "group_part" | "group_custom" | "group_kaf" | "group_simulations"> = {
  full: "group_full",
  part: "group_part",
  custom: "group_custom",
  kaf: "group_kaf",
  simulations: "group_simulations",
};

function parseList(d: unknown): { rows: AttemptRow[]; total: number | null; access: ListAccess } {
  const body = d as { attempts?: unknown; total?: unknown; access?: unknown } | null;
  if (!body || !Array.isArray(body.attempts)) throw new Error("Invalid history");
  return {
    rows: body.attempts as AttemptRow[],
    total: typeof body.total === "number" ? body.total : null,
    access: body.access === "full" ? "full" : "summary",
  };
}

export default function HistoryList() {
  const signedIn = useSignedInRoute();
  const lang = useLang();
  const router = useRouter();
  const { audience, isLoading: tierLoading, error: tierError } = useUserTier();

  const [rows, setRows] = useState<AttemptRow[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [access, setAccess] = useState<ListAccess>("summary");
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const [tab, setTab] = useState<"exams" | "questions">("exams");
  const [quiz, setQuiz] = useState<QuizStats | null>(null);
  const busy = useRef(false);
  const restored = useRef(false);

  // Old deep links (/history?attempt=<id>) open the detail route.
  useEffect(() => {
    const href = legacyDetailHref(window.location.search);
    if (href) router.replace(href);
  }, [router]);

  // Send the learner back to finish saving once per tab; never trap History
  // behind a result the server keeps refusing.
  useEffect(() => {
    const id = getStoredSession()?.user?.id;
    try {
      if (id && loadPendingExams(id).length && !sessionStorage.getItem("medpruef_history_pending_redirected")) {
        sessionStorage.setItem("medpruef_history_pending_redirected", "1");
        window.location.replace("/exam");
      }
    } catch { /* storage blocked: stay on History */ }
  }, []);

  const load = useCallback(async (offset: number) => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    try {
      const res = await authFetch(`/api/history/exams?limit=${PAGE}&offset=${offset}`);
      if (!res.ok) throw new Error(`History unavailable (${res.status})`);
      const parsed = parseList(await res.json());
      const id = getStoredSession()?.user?.id ?? "";
      setRows((prev) => {
        const next = offset > 0 && prev ? [...prev, ...parsed.rows.filter((r) => !prev.some((p) => p.id === r.id))] : parsed.rows;
        listCache = { account: id, rows: next, total: parsed.total, access: parsed.access };
        return next;
      });
      setTotal(parsed.total);
      setAccess(parsed.access);
      if (offset > 0) setMoreError(false);
      else setError(false);
    } catch {
      if (offset > 0) setMoreError(true);
      else setError(true);
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    const id = getStoredSession()?.user?.id ?? "";
    if (listCache && listCache.account === id) {
      setRows(listCache.rows);
      setTotal(listCache.total);
      setAccess(listCache.access);
    }
    const saved = readListState();
    if (saved) setTab(saved.tab);
    void load(0);
  }, [signedIn, load]);

  // Practice statistics for Pro only (the source is the quiz, not exams).
  useEffect(() => {
    if (access !== "full") return;
    let alive = true;
    void (async () => {
      try {
        const res = await authFetch("/api/stats");
        if (!res.ok) return;
        const gam = ((await res.json())?.gamification ?? {}) as Record<string, unknown>;
        const answered = typeof gam.total_questions_answered === "number" ? gam.total_questions_answered : null;
        const correct = typeof gam.total_correct === "number" ? gam.total_correct : null;
        if (!alive) return;
        setQuiz({
          answered,
          accuracy: answered && correct !== null ? Math.round((correct / answered) * 100) : null,
          streak: typeof gam.current_streak === "number" ? gam.current_streak : null,
        });
      } catch { /* the practice strip is best-effort */ }
    })();
    return () => { alive = false; };
  }, [access]);

  // Keep tab and scroll for the return from a detail.
  useEffect(() => {
    if (!signedIn) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => writeListState({ tab, scrollY: window.scrollY }));
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { cancelAnimationFrame(frame); window.removeEventListener("scroll", onScroll); };
  }, [signedIn, tab]);

  // Restore the scroll position once, after the rows are on screen.
  useEffect(() => {
    if (restored.current || rows === null) return;
    restored.current = true;
    const saved = readListState();
    if (saved && saved.scrollY > 0) requestAnimationFrame(() => window.scrollTo(0, saved.scrollY));
  }, [rows]);

  const chooseTab = (next: "exams" | "questions") => {
    setTab(next);
    writeListState({ tab: next, scrollY: 0 });
  };

  const overview = useMemo(() => overviewOf(rows, total), [rows, total]);
  const trend = useMemo(() => (rows ? pickTrend(rows) : null), [rows]);
  const groups = useMemo(() => (rows ? groupRows(rows) : []), [rows]);
  const full = access === "full";
  const activeTab = full ? tab : "exams";
  const lapsed = !tierLoading && !tierError && audience === "lapsed";

  if (!signedIn) {
    return <Skeleton variant="card" className="min-h-40" />;
  }

  return (
    <div>
      <PageHeader title={th("title", lang)} subtitle={th(full ? "subtitle_full" : "subtitle_summary", lang)} back />

      <OverviewStrip overview={overview} quiz={full ? quiz : null} lang={lang} />

      {full && (
        <div className="mp-tabs mb-4" role="tablist" aria-label={th("tabs_label", lang)}>
          {(["exams", "questions"] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={activeTab === id}
              onClick={() => chooseTab(id)}
              className={`mp-tabs__tab min-h-11 ${activeTab === id ? "mp-tabs__tab--active" : ""}`}
            >
              {th(id === "exams" ? "tab_exams" : "tab_questions", lang)}
            </button>
          ))}
        </div>
      )}

      {activeTab === "questions" ? (
        <QuestionsTab lang={lang} />
      ) : (
        <section aria-busy={loading && rows === null}>
          {error && (
            <Alert variant="error" title={th("load_error", lang)} className="mb-4">
              <button type="button" className="mp-btn mp-btn--secondary mt-2 min-h-11" disabled={loading} onClick={() => void load(0)}>
                {th("retry", lang)}
              </button>
            </Alert>
          )}

          {!full && rows !== null && rows.length > 0 && (
            <div className="card mb-5 flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
              <p className="flex-1 text-[14px] text-[var(--mp-fg)]">
                {lapsed ? `${th("wall_title_lapsed", lang)} ${th("wall_kept", lang)}` : th("summary_note", lang)}
              </p>
              <Link href="/pricing?gate=history" className="mp-btn mp-btn--primary min-h-11 shrink-0">
                {th("to_pro", lang)}
              </Link>
            </div>
          )}

          {rows === null ? (
            error ? null : (
              <div className="space-y-2.5" aria-hidden>
                <Skeleton variant="card" className="h-20" />
                <Skeleton variant="card" className="h-20" />
                <Skeleton variant="card" className="h-20" />
              </div>
            )
          ) : rows.length === 0 ? (
            error ? null : (
              <EmptyState
                icon={<HistoryIcon className="h-10 w-10" />}
                title={th("empty_title", lang)}
                body={th("empty_body", lang)}
                action={<Link href="/exam" className="mp-btn mp-btn--primary min-h-11">{th("start_simulation", lang)}</Link>}
              />
            )
          ) : (
            <>
              {trend && <TrendChart trend={trend} lang={lang} />}
              {groups.map(({ group, rows: groupList }) => (
                <section key={group} className="mb-5" aria-labelledby={`history-group-${group}`}>
                  <h2 id={`history-group-${group}`} className="mb-2 text-[15px] font-bold text-[var(--mp-fg)]">
                    {th(GROUP_KEY[group], lang)}
                  </h2>
                  <ul className="space-y-2.5">
                    {groupList.map((row) => (
                      <li key={row.id}>
                        <ExamRow row={row} lang={lang} linked={full} />
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
              {moreError && (
                <Alert variant="error" title={th("load_error", lang)} className="mb-3">
                  <button type="button" className="mp-btn mp-btn--secondary mt-2 min-h-11" disabled={loading} onClick={() => void load(rows.length)}>
                    {th("retry", lang)}
                  </button>
                </Alert>
              )}
              {total !== null && rows.length < total && (
                <button
                  type="button"
                  className="mp-btn mp-btn--secondary mt-1 min-h-11 w-full"
                  disabled={loading}
                  aria-busy={loading}
                  onClick={() => void load(rows.length)}
                >
                  {loading ? th("loading_more", lang) : th("load_more", lang)}
                </button>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
