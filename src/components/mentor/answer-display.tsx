import type { ReactNode } from "react";

/** Display only. Never rewrites validator input, treats model markdown as ordinary text. */
export function displayInline(text: string, confirmedDates: readonly string[] = [], rtl = false): ReactNode[] {
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
    if (token.kind === "date") out.push(<strong key={`d${token.start}`} className="font-semibold">{token.text}</strong>);
    else if (token.kind === "term") out.push(<bdi key={`t${token.start}`} dir="ltr">{token.text}</bdi>);
    else {
      try { out.push(<bdi key={`u${token.start}`} dir="ltr"><a href={token.text} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 break-all">{new URL(token.text).hostname}</a></bdi>); }
      catch { out.push(token.text); }
    }
    cursor = token.end;
  }
  out.push(text.slice(cursor)); return out;
}
export function AnswerText({ text, confirmedDates = [], rtl = false }: { text: string; confirmedDates?: readonly string[]; rtl?: boolean }) {
  const groups: Array<{ bullets: boolean; lines: string[] }> = [];
  for (const line of text.split("\n")) {
    const bullets = line.startsWith("- "); const previous = groups.at(-1);
    if (previous?.bullets === bullets) previous.lines.push(bullets ? line.slice(2) : line);
    else groups.push({ bullets, lines: [bullets ? line.slice(2) : line] });
  }
  return <div className="space-y-1 whitespace-pre-wrap break-words text-[14.5px] leading-relaxed text-[var(--mp-fg)]">{groups.map((group, i) => group.bullets ? <ul key={i} className="list-disc space-y-1 ps-5">{group.lines.map((line, j) => <li key={j} dir="auto">{displayInline(line, confirmedDates, rtl)}</li>)}</ul> : <p key={i} dir="auto">{displayInline(group.lines.join("\n"), confirmedDates, rtl)}</p>)}</div>;
}
