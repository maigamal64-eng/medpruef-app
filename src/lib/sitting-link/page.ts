/**
 * HTML of the one-tap sitting page (a-sitting-one-tap). Self-contained like
 * the a30 reminder link pages: no script, no external asset, inline styles,
 * light and dark, 44px targets, works at 320px. Every value is escaped.
 */
import { NextResponse } from "next/server";
import { escapeHtml as e, noStore } from "@/lib/reminders/common";
import { deadlineLabel, formatClose, formatSittingWhen, joinList, shortExamName } from "@/lib/i18n-dates";
import type { PuypExamType } from "@/lib/exam-dates";
import { fill, sittingLinkCopy, type SittingLinkCopy } from "./copy";
import { officialSources, type BankOptions, type SittingOption, type TimeLeft } from "./candidates";
import type { SittingLinkLang } from "./token";

const SITE = "https://medpruf.com";
const ACTION = "/api/sitting-link";

const CSS = `:root{color-scheme:light dark;--bg:#F7F9FC;--fg:#1A2B3C;--muted:#4A5568;--card:#fff;--border:#E4E9F0;--accent:#003A8C;--on-accent:#fff;--sel:#007B5F}
@media (prefers-color-scheme:dark){:root{--bg:#0F172A;--fg:#E2E8F0;--muted:#A0AEC0;--card:#1E293B;--border:#334155;--accent:#4D8DF0;--on-accent:#001B3D;--sel:#34D399}}
*{box-sizing:border-box}body{font-family:-apple-system,system-ui,"Segoe UI",Roboto,sans-serif;margin:0;padding:24px 16px 40px;background:var(--bg);color:var(--fg);line-height:1.55;overflow-wrap:anywhere}
main{max-width:560px;margin:0 auto}h1{font-size:22px;margin:0 0 8px}h2{font-size:16px;margin:24px 0 8px}p{margin:0 0 12px}.muted{color:var(--muted);font-size:14px}
fieldset{border:0;margin:0;padding:0}legend{padding:0}.opt{display:flex;gap:12px;align-items:flex-start;min-height:44px;padding:12px;margin:0 0 8px;background:var(--card);border:1px solid var(--border);border-radius:10px;cursor:pointer}
.opt input{width:20px;height:20px;margin:2px 0 0;flex:none;accent-color:var(--sel)}.opt:has(input:checked){border-color:var(--sel)}.opt b{display:block}.opt small{display:block;color:var(--muted);font-size:13px}
.check{display:flex;gap:12px;align-items:flex-start;min-height:44px;margin:16px 0}.check input{width:20px;height:20px;margin:2px 0 0;flex:none;accent-color:var(--sel)}
button,.btn{display:inline-flex;align-items:center;justify-content:center;font:inherit;font-weight:600;min-height:44px;padding:10px 20px;border:0;border-radius:8px;background:var(--accent);color:var(--on-accent);cursor:pointer;text-decoration:none}
.btn-quiet{background:transparent;color:var(--accent);border:1px solid var(--border)}.card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:16px;margin:16px 0}
a{color:var(--accent)}.links a{display:inline-block;min-height:44px;padding:10px 0}ul{padding-left:20px}.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}`;

function shell(lang: SittingLinkLang, inner: string, status: number) {
  const t = sittingLinkCopy(lang);
  const html = `<!DOCTYPE html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>MedPrüf: ${e(t.title)}</title><style>${CSS}</style></head><body><main><h1>${e(t.title)}</h1>${inner}<p class="links"><a href="${SITE}/">${e(t.home)}</a></p></main></body></html>`;
  return new NextResponse(html, {
    status,
    headers: {
      ...noStore,
      "Content-Type": "text/html; charset=utf-8",
      "X-Robots-Tag": "noindex",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    },
  });
}

function examName(o: SittingOption, lang: SittingLinkLang): string {
  const first = o.rows[0];
  return first.exam_key === "stichprobentest"
    ? first.learner_label[lang]
    : joinList(o.rows.map((r) => shortExamName(r, lang)), lang);
}

function optionTitle(o: SittingOption, lang: SittingLinkLang, t: SittingLinkCopy): string {
  return fill(t.sittingOn, { exam: examName(o, lang), when: formatSittingWhen(o.rows[0], lang) });
}

/** One line per distinct deadline (both Stichprobentest publishers where they differ). */
function deadlineLines(o: SittingOption, lang: SittingLinkLang): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const r of [...o.rows].sort((a, b) => (a.registration_closes ?? "").localeCompare(b.registration_closes ?? ""))) {
    if (!r.registration_closes) continue;
    const line = `${deadlineLabel(r, lang)}: ${formatClose(r, lang)}`;
    if (seen.has(line)) continue;
    seen.add(line);
    lines.push(line);
  }
  return lines;
}

function bankBlock(b: BankOptions, lang: SittingLinkLang, t: SittingLinkCopy, savedId: string | null, other: boolean): string {
  const head = `<h2>${e(t.bank[b.bank])}</h2>${other ? `<p class="muted">${e(t.switchNote)}</p>` : ""}`;
  if (b.options.length === 0) return `${head}<p class="muted">${e(t.noneListed)}</p>`;
  const opts = b.options.map((o) => {
    const saved = o.id === savedId;
    const small = deadlineLines(o, lang).map((l) => `<small>${e(l)}</small>`).join("");
    return `<label class="opt"><input type="radio" name="choice" value="${e(o.id)}"${saved ? " checked" : ""} required><span><b>${e(optionTitle(o, lang, t))}${saved ? ` (${e(t.saved_marker)})` : ""}</b>${small}</span></label>`;
  }).join("");
  const sources = officialSources(b.options.flatMap((o) => o.rows))
    .map((s) => `<a href="${e(s.url)}" target="_blank" rel="noopener noreferrer">${e(fill(t.official, { publisher: s.publisher }))}</a>`)
    .join(" · ");
  return `${head}${opts}<p class="links muted">${sources}</p>`;
}

export interface FormArgs {
  lang: SittingLinkLang;
  token: string;
  banks: BankOptions[];
  /** "<bank>:<date>" of the saved exam date when it is one of the options. */
  savedId: string | null;
  showReminder: boolean;
  notice?: string;
}

/** GET: the choice form. Nothing is written until the button POSTs. */
export function formPage(a: FormArgs) {
  const t = sittingLinkCopy(a.lang);
  const [own, ...rest] = a.banks;
  const blocks = [
    own ? bankBlock(own, a.lang, t, a.savedId, false) : "",
    rest.length ? `<h2>${e(t.otherBanks)}</h2>${rest.map((b) => bankBlock(b, a.lang, t, a.savedId, true)).join("")}` : "",
  ].join("");
  const openOpt = `<label class="opt"><input type="radio" name="choice" value="open" required><span><b>${e(t.open)}</b></span></label>`;
  const reminder = a.showReminder
    ? `<label class="check"><input type="checkbox" name="reminder" value="1"><span>${e(t.reminder)}</span></label>`
    : "";
  const notice = a.notice ? `<p class="card" role="status">${e(a.notice)}</p>` : "";
  return shell(a.lang, `${notice}<p>${e(t.lead)}</p><form method="post" action="${ACTION}"><input type="hidden" name="t" value="${e(a.token)}"><input type="hidden" name="lang" value="${a.lang}"><fieldset><legend class="sr">${e(t.title)}</legend>${blocks}<div style="height:16px"></div>${openOpt}</fieldset>${reminder}<p class="muted">${e(t.nothingYet)}</p><button type="submit">${e(t.save)}</button></form>`, 200);
}

export interface ResultArgs {
  lang: SittingLinkLang;
  saved: { option: SittingOption; left: TimeLeft } | null;
  reminder: "sent" | "already" | "unsupported" | "not_now" | null;
  fit: { plan: string; total: string; pricingUrl: string } | null;
  trial: { offer: string; cta: string; url: string } | null;
}

function leftLine(left: TimeLeft, t: SittingLinkCopy): string {
  if (left.unit === "today") return t.left.today;
  if (left.unit === "days") return left.n === 1 ? t.left.day : fill(t.left.days, { n: left.n });
  return left.n === 1 ? t.left.week : fill(t.left.weeks, { n: left.n });
}

/** After the POST: what was saved, the weeks to the sitting, then any offer (price last). */
export function resultPage(a: ResultArgs) {
  const t = sittingLinkCopy(a.lang);
  const parts: string[] = [];
  if (a.saved) {
    const o = a.saved.option;
    parts.push(`<p role="status"><b>${e(fill(t.savedSitting, { exam: examName(o, a.lang), when: formatSittingWhen(o.rows[0], a.lang) }))}</b></p>`);
    parts.push(`<p>${e(leftLine(a.saved.left, t))}</p>`);
    const src = officialSources(o.rows).map((s) => `<a href="${e(s.url)}" target="_blank" rel="noopener noreferrer">${e(fill(t.official, { publisher: s.publisher }))}</a>`).join(" · ");
    parts.push(`<p class="links muted">${src}</p>`);
  } else {
    parts.push(`<p role="status"><b>${e(t.savedOpen)}</b></p>`);
  }
  if (a.reminder) parts.push(`<p>${e(t.reminderResult[a.reminder])}</p>`);
  parts.push(`<p><a class="btn" href="${SITE}/study-plan">${e(t.toPlan)}</a></p>`);
  if (a.fit) {
    parts.push(`<div class="card"><h2 style="margin-top:0">${e(t.fitTitle)}</h2><p>${e(fill(t.fitLine, { plan: a.fit.plan, total: a.fit.total }))}</p><a class="btn btn-quiet" href="${e(a.fit.pricingUrl)}">${e(t.seePlans)}</a></div>`);
  }
  if (a.trial) {
    parts.push(`<div class="card"><p>${e(a.trial.offer)}</p><a class="btn btn-quiet" href="${e(a.trial.url)}">${e(a.trial.cta)}</a></div>`);
  }
  return shell(a.lang, parts.join(""), 200);
}

/** The date-watch freeze: no date, no choice, no offer; only the official pages. */
export function frozenPage(lang: SittingLinkLang, sources: Array<{ bank: PuypExamType; sources: Array<{ publisher: string; url: string }> }>) {
  const t = sittingLinkCopy(lang);
  const items = sources.map((b) => `<li>${e(t.bank[b.bank])}: ${b.sources.map((s) => `<a href="${e(s.url)}" target="_blank" rel="noopener noreferrer">${e(s.publisher)}</a>`).join(", ")}</li>`).join("");
  return shell(lang, `<p>${e(t.frozen)}</p><ul class="links">${items}</ul>`, 200);
}

export function messagePage(lang: SittingLinkLang, kind: "invalid" | "expired" | "retry" | "unavailable") {
  const t = sittingLinkCopy(lang);
  const status = kind === "unavailable" ? 404 : kind === "retry" ? 503 : kind === "expired" ? 410 : 400;
  const settings = kind === "invalid" || kind === "expired" ? `<p><a class="btn btn-quiet" href="${SITE}/settings">${e(t.settings)}</a></p>` : "";
  const res = shell(lang, `<p role="status">${e(t[kind])}</p>${settings}`, status);
  if (kind === "retry") res.headers.set("Retry-After", "60");
  return res;
}
