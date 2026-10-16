/**
 * Minimal RFC 5545 writer for all-day events (a-exam-calendar-feed).
 *
 * All-day only: a timed event needs a VTIMEZONE block that Apple Calendar
 * rejects when it is slightly off, so the closing time goes into the text.
 * CRLF line ends, content lines folded at 75 octets (bytes, not characters),
 * TEXT escaped, stable UIDs and DTSTAMP so subscribers see no churn.
 */

export interface IcsEvent {
  uid: string;
  /** YYYY-MM-DD */
  start: string;
  /** Exclusive, YYYY-MM-DD, after start. */
  endExclusive: string;
  summary: string;
  description: string;
  url?: string;
  /** YYYY-MM-DD the source was read; becomes DTSTAMP at 00:00:00Z. */
  stampDay: string;
  /** Display alarm the evening before (closing days only). */
  alarmText?: string;
  /** TENTATIVE for the MedPrüf study reminder so no client shows it as official. */
  tentative?: boolean;
}

export interface IcsCalendar {
  name: string;
  description: string;
  events: IcsEvent[];
}

export const PRODID = "-//MedPruef//Exam calendar feed//EN";

export function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");
}

/** Fold one logical line at 75 octets; continuation lines start with one space. */
export function foldLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const n = Buffer.byteLength(ch, "utf8");
    if (bytes + n > limit) {
      out.push(cur);
      cur = " ";
      bytes = 1;
      limit = 75;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out;
}

const compact = (iso: string) => iso.replace(/-/g, "");

export function buildIcs(cal: IcsCalendar): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(cal.name)}`,
    `X-WR-CALDESC:${escapeText(cal.description)}`,
    "REFRESH-INTERVAL;VALUE=DURATION:P1D",
    "X-PUBLISHED-TTL:P1D",
  ];
  for (const e of cal.events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}`,
      `DTSTAMP:${compact(e.stampDay)}T000000Z`,
      `DTSTART;VALUE=DATE:${compact(e.start)}`,
      `DTEND;VALUE=DATE:${compact(e.endExclusive)}`,
      `SUMMARY:${escapeText(e.summary)}`,
      `DESCRIPTION:${escapeText(e.description)}`,
    );
    if (e.url) lines.push(`URL:${e.url}`);
    lines.push(`STATUS:${e.tentative ? "TENTATIVE" : "CONFIRMED"}`, "TRANSP:TRANSPARENT", "SEQUENCE:0");
    if (e.alarmText) {
      lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${escapeText(e.alarmText)}`, "TRIGGER:-PT15H", "END:VALARM");
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.flatMap(foldLine).join("\r\n") + "\r\n";
}
