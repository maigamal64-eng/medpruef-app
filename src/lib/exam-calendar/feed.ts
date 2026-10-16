import { buildIcs, type IcsEvent } from "./ics";
import { FEED_COPY, parseFeedLang, type FeedLang } from "./feed-copy";
import {
  FEED_IDS,
  feedEvents,
  learnerFeedEvents,
  type FeedEvent,
  type FeedId,
  type LearnerFeedInput,
} from "./feed-moments";

export { parseFeedLang };

const SITE = "https://medpruf.com";

/** Single switch. Off (default): every feed is a valid calendar with zero events. */
export const calendarFeedEnabled = () => process.env.EXAM_CALENDAR_FEED_ENABLED === "true";

export function parseFeedId(raw: string): FeedId | null {
  const id = raw.replace(/\.ics$/i, "").toLowerCase();
  return (FEED_IDS as readonly string[]).includes(id) ? (id as FeedId) : null;
}

function dayText(iso: string, lang: FeedLang): string {
  const [y, m, d] = iso.split("-");
  if (lang === "de") return `${d}.${m}.${y}`;
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m) - 1];
  return `${Number(d)} ${month} ${y}`;
}

const shortPublisher = (p: string) => p.replace("Medizinische Universität", "MedUni");

function toIcs(e: FeedEvent, lang: FeedLang, back: { text: string; href: string }): IcsEvent {
  const c = FEED_COPY[lang];
  const week = e.moment === "exam" && !!e.sittingEnd && e.sittingEnd !== e.sittingDate;
  const kind =
    e.moment === "opens" ? c.opens
    : e.moment === "closes" ? (e.deadlineType === "both" ? c.closesBoth : e.deadlineType === "filing_cutoff" ? c.closesFiling : c.closesRegistration)
    : e.moment === "t28" ? c.t28
    : week ? c.examWeek : c.exam;
  // Two publishers on one sitting must stay tellable apart in the title.
  const tag = e.moment === "closes" || e.moment === "opens" ? ` (${e.publishers.map(shortPublisher).join(", ")})` : "";
  const summary = `${e.label[lang]}: ${kind}${e.examKey === "stichprobentest" ? tag : ""}`;
  const body =
    e.moment === "opens" ? c.opensText
    : e.moment === "closes" ? `${c.closesText}${e.closesAt ? c.closesTime(e.closesAt) : ""}.`
    : e.moment === "t28" ? c.t28Text
    : week ? c.examWeekText : c.examText;
  const description = [
    body,
    c.source(e.publishers.join(", ")),
    ...e.sourceUrls.map((u) => `${c.official} ${u}`),
    c.readOn(dayText(e.readOn, lang)),
    `${back.text} ${back.href}`,
  ].join("\n");
  return {
    uid: e.uid,
    start: e.start,
    endExclusive: e.endExclusive,
    summary,
    description,
    url: e.sourceUrls[0],
    stampDay: e.readOn,
    alarmText: e.moment === "closes" ? c.alarm(summary) : undefined,
    tentative: e.moment === "t28",
  };
}

const utm = (campaign: string, content: "public" | "personal") =>
  `utm_source=calendar&utm_medium=ics&utm_campaign=${campaign}&utm_content=${content}`;

export function renderPublicFeed(feed: FeedId, lang: FeedLang, enabled: boolean, now: Date = new Date()): string {
  const c = FEED_COPY[lang];
  const events = enabled ? feedEvents(feed, now) : [];
  const href = (e?: FeedEvent) =>
    `${SITE}/pruefungskalender?${utm(e?.examKey ?? feed, "public")}${lang === "en" ? "&lang=en" : ""}`;
  return buildIcs({
    name: c.calPublic,
    description: c.calDesc,
    events: events.map((e) => toIcs(e, lang, { text: c.backPublic, href: href(e) })),
  });
}

export function renderPersonalFeed(input: LearnerFeedInput, lang: FeedLang, enabled: boolean, now: Date = new Date()): string {
  const c = FEED_COPY[lang];
  const events = enabled ? learnerFeedEvents(input, now) : [];
  return buildIcs({
    name: c.calPersonal,
    description: c.calDesc,
    events: events.map((e) => toIcs(e, lang, { text: c.backPersonal, href: `${SITE}/study-plan?${utm(e.examKey, "personal")}` })),
  });
}

export const ICS_HEADERS = {
  "Content-Type": "text/calendar; charset=utf-8",
  "Content-Disposition": 'inline; filename="medpruf-pruefungstermine.ics"',
  "X-Content-Type-Options": "nosniff",
} as const;
