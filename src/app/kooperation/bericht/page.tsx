/**
 * /kooperation/bericht?t=<signed link> (a-partner-kit): the organiser's read of
 * their own code. The link is signed with REMINDER_LINK_SIGNING_SECRET (purpose
 * partner-report, expiry inside), names only a partner code and is checked
 * against PARTNER_CODES. Shows three totals; every count under 5 reads
 * "unter 5" (src/lib/partner-kit/report.ts). No learner id, name, address or
 * individual figure ever reaches this page. An invalid, expired or unknown link
 * gets the same neutral message, never a hint which part failed.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { after } from "next/server";
import { callerIp, checkRateLimit, rateKey } from "@/lib/rate-limit";
import { getServiceClient } from "@/lib/supabase";
import { PARTNER_REPORT_PATH, isPartnerCode, partnerKitEnabled, partnerLang } from "@/lib/partner-kit";
import { reportCopy } from "@/lib/partner-kit/copy";
import { shapeReport, shownText } from "@/lib/partner-kit/report";
import { readPartnerRaw } from "@/lib/partner-kit/server";
import { readPartnerReportToken } from "@/lib/reminders/tokens";

export const dynamic = "force-dynamic";

// A signed link is a credential: never indexed, never sent as a referrer.
export const metadata: Metadata = { title: "MedPrüf", robots: { index: false, follow: false }, referrer: "no-referrer" };

type Params = Record<string, string | string[] | undefined>;

const CACHE_MS = 10 * 60_000;
const rawCache = new Map<string, { at: number; raw: Awaited<ReturnType<typeof readPartnerRaw>> }>();
async function cachedRaw(code: string, now: Date) {
  const hit = rawCache.get(code);
  if (hit && now.getTime() - hit.at < CACHE_MS) return hit.raw;
  const raw = await readPartnerRaw(getServiceClient(), code, now);
  if (raw) rawCache.set(code, { at: now.getTime(), raw });
  return raw;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="mp-card min-w-0 p-5">
      <p className="text-sm text-[var(--mp-fg-muted)]">{label}</p>
      <p className="mt-1 font-display text-3xl font-extrabold tabular-nums" data-testid="partner-metric">{value}</p>
    </div>
  );
}

export default async function Page({ searchParams }: { searchParams: Promise<Params> }) {
  if (!partnerKitEnabled()) notFound();
  const sp = await searchParams;
  const lang = partnerLang(Array.isArray(sp.lang) ? sp.lang[0] : sp.lang);
  const c = reportCopy(lang);
  const t = Array.isArray(sp.t) ? sp.t[0] : sp.t;
  const code = typeof t === "string" ? readPartnerReportToken(t) : null;
  if (!code || !isPartnerCode(code)) {
    return (
      <main lang={lang} className="mx-auto max-w-2xl px-4 py-16 text-[var(--mp-fg)]" data-testid="partner-report-invalid">
        <p role="status" className="text-base">{c.expired}</p>
      </main>
    );
  }
  const now = new Date();
  // A link can be forwarded: 20 opens a minute per address, and one read per code per 10 minutes per instance (the report moves slowly).
  const gate = checkRateLimit({ key: rateKey("partner-report", callerIp({ headers: await headers() })), limit: 20, windowMs: 60_000 });
  let raw = null;
  if (gate.allowed) {
    try { raw = await cachedRaw(code, now); } catch { raw = null; }
  }
  const report = raw ? shapeReport(raw) : null;
  // Measurement: one server row per opening, only for a valid link (the code is a partner code, not a person).
  after(async () => {
    try {
      await getServiceClient().from("user_activity_log").insert({ user_id: null, session_id: `partner-report:${code}`, event_type: "funnel_partner_report_open", page: PARTNER_REPORT_PATH, action: "partner_report_open", metadata: { code: code.toLowerCase(), anonymous: true } });
    } catch { /* measurement never blocks the page */ }
  });
  const when = new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "de-AT", { timeZone: "Europe/Vienna", dateStyle: "long", timeStyle: "short" }).format(now);
  const val = (s: ReturnType<typeof shapeReport>["redemptions"] | undefined) => (s ? shownText(s, c.small, lang) : c.unavailable);
  return (
    <main lang={lang} className="mx-auto min-w-0 max-w-3xl px-4 pb-24 pt-10 text-[var(--mp-fg)] sm:px-8" data-testid="partner-report">
      <h1 className="font-display text-2xl font-extrabold sm:text-3xl">{c.title(code)}</h1>
      <p className="mt-3 text-base leading-relaxed">{c.lead}</p>
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <Metric label={c.redemptions} value={val(report?.redemptions)} />
        <Metric label={c.active} value={val(report?.active)} />
        <Metric label={c.answers} value={val(report?.answers)} />
      </div>
      <p className="mt-6 text-[13px] leading-relaxed text-[var(--mp-fg-muted)]">{c.privacy}{report?.answersRounded ? ` ${c.roundedNote}` : ""}</p>
      <p className="mt-2 text-[13px] text-[var(--mp-fg-muted)]">{c.updated(when)}</p>
    </main>
  );
}
