import type { ReactNode } from "react";

/**
 * Display only. Never rewrites validator input. The one markdown form rendered
 * is paired **bold** (the deadline template and some model terms use it); every
 * other markdown stays ordinary text. Bold only opens and closes at a word
 * boundary, so it never joins two pieces the validator saw apart (1**9...).
 * No lookbehind: older iOS Safari cannot parse it and the whole chunk would
 * fail to load, so the boundary character before the opener is captured.
 */
const BOLD = /(^|[^\p{L}\p{N}*])\*\*([^\s*](?:[^*\n]*[^\s*])?)\*\*(?![\p{L}\p{N}*])/gu;
export function displayInline(text: string, confirmedDates: readonly string[] = [], rtl = false): ReactNode[] {
  const out: ReactNode[] = []; let cursor = 0;
  for (const match of text.matchAll(BOLD)) {
    const start = match.index! + match[1].length;
    if (start > cursor) out.push(...plainInline(text.slice(cursor, start), confirmedDates, rtl, `p${cursor}`));
    out.push(<strong key={`b${start}`} className="font-semibold">{plainInline(match[2], confirmedDates, rtl, `b${start}`)}</strong>);
    cursor = match.index! + match[0].length;
  }
  if (cursor === 0) return plainInline(text, confirmedDates, rtl, "p");
  if (cursor < text.length) out.push(...plainInline(text.slice(cursor), confirmedDates, rtl, `p${cursor}`));
  return out;
}

/**
 * Dates, links and RTL term runs inside one run of text. An unpaired ** is
 * dropped only next to a space or the run's edge; between two characters it
 * stays, so stripping can never join a URL or a date the validator saw apart.
 */
function plainInline(raw: string, confirmedDates: readonly string[], rtl: boolean, prefix: string): ReactNode[] {
  const text = raw.replace(/(^|\s)\*\*+|\*\*+(?=\s|$)/g, "$1");
  const tokens: Array<{ start: number; end: number; kind: "date" | "url" | "term"; text: string }> = [];
  for (const match of text.matchAll(/https:\/\/[^\s<>]+/g)) {
    const url = match[0].replace(/[.,;!?)]*$/, "");
    tokens.push({ start: match.index!, end: match.index! + url.length, kind: "url", text: url });
  }
  for (const date of confirmedDates) {
    if (!date) continue;
    for (let start = text.indexOf(date); start >= 0; start = text.indexOf(date, start + date.length)) tokens.push({ start, end: start + date.length, kind: "date", text: date });
  }
  // In Arabic, German/Latin term runs are isolated without interpreting model HTML.
  if (rtl) for (const match of text.matchAll(/[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß0-9]*(?:[- ][A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß0-9]*)*/g)) tokens.push({ start: match.index!, end: match.index! + match[0].length, kind: "term", text: match[0] });
  tokens.sort((a, b) => a.start - b.start || b.end - a.end);
  const out: ReactNode[] = []; let cursor = 0;
  for (const token of tokens) {
    if (token.start < cursor) continue;
    out.push(text.slice(cursor, token.start));
    if (token.kind === "date") out.push(<strong key={`${prefix}d${token.start}`} className="font-semibold">{token.text}</strong>);
    else if (token.kind === "term") out.push(<bdi key={`${prefix}t${token.start}`} dir="ltr">{token.text}</bdi>);
    else {
      try { out.push(<bdi key={`${prefix}u${token.start}`} dir="ltr"><a href={token.text} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 break-all">{new URL(token.text).hostname}</a></bdi>); }
      catch { out.push(token.text); }
    }
    cursor = token.end;
  }
  out.push(text.slice(cursor)); return out;
}
/** `trailing` (citation markers) is appended inside the last paragraph or list item, on its last line. */
export function AnswerText({ text, confirmedDates = [], rtl = false, trailing }: { text: string; confirmedDates?: readonly string[]; rtl?: boolean; trailing?: ReactNode }) {
  const groups: Array<{ bullets: boolean; lines: string[] }> = [];
  for (const line of text.split("\n")) {
    const bullets = line.startsWith("- "); const previous = groups.at(-1);
    if (previous?.bullets === bullets) previous.lines.push(bullets ? line.slice(2) : line);
    else groups.push({ bullets, lines: [bullets ? line.slice(2) : line] });
  }
  const last = groups.length - 1;
  return <div className="space-y-1 whitespace-pre-wrap break-words text-[14.5px] leading-relaxed text-[var(--mp-fg)]">{groups.map((group, i) => group.bullets ? <ul key={i} className="list-disc space-y-1 ps-5">{group.lines.map((line, j) => <li key={j} dir="auto">{displayInline(line, confirmedDates, rtl)}{i === last && j === group.lines.length - 1 && trailing}</li>)}</ul> : <p key={i} dir="auto">{displayInline(group.lines.join("\n"), confirmedDates, rtl)}{i === last && trailing}</p>)}</div>;
}
