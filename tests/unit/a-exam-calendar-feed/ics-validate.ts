/** Small RFC 5545 checker for the feed output (no parser dependency in the repo). */
export interface ParsedEvent { props: Record<string, string[]>; }
export function validateIcs(text: string): { events: ParsedEvent[]; errors: string[] } {
  const errors: string[] = [];
  if (!text.endsWith("\r\n")) errors.push("must end with CRLF");
  if (/(^|[^\r])\n/.test(text)) errors.push("bare LF found");
  const raw = text.split("\r\n");
  if (raw[raw.length - 1] === "") raw.pop();
  for (const l of raw) if (Buffer.byteLength(l, "utf8") > 75) errors.push(`line over 75 octets: ${l.slice(0, 30)}`);
  const lines: string[] = [];
  for (const l of raw) { if (l.startsWith(" ")) { if (!lines.length) errors.push("fold at start"); else lines[lines.length - 1] += l.slice(1); } else lines.push(l); }
  if (lines[0] !== "BEGIN:VCALENDAR") errors.push("starts with BEGIN:VCALENDAR");
  if (lines[lines.length - 1] !== "END:VCALENDAR") errors.push("ends with END:VCALENDAR");
  for (const need of ["VERSION:2.0"]) if (!lines.includes(need)) errors.push(`missing ${need}`);
  if (!lines.some((l) => l.startsWith("PRODID:"))) errors.push("missing PRODID");
  const events: ParsedEvent[] = [];
  const stack: string[] = [];
  let cur: ParsedEvent | null = null;
  for (const l of lines) {
    if (l.startsWith("BEGIN:")) { stack.push(l.slice(6)); if (l === "BEGIN:VEVENT") cur = { props: {} }; continue; }
    if (l.startsWith("END:")) {
      if (stack.pop() !== l.slice(4)) errors.push(`unbalanced ${l}`);
      if (l === "END:VEVENT" && cur) { events.push(cur); cur = null; }
      continue;
    }
    if (cur && stack[stack.length - 1] === "VEVENT") {
      const i = l.indexOf(":");
      const name = l.slice(0, i).split(";")[0];
      (cur.props[name] ??= []).push(l.slice(i + 1));
    }
  }
  if (stack.length) errors.push("unclosed components");
  const uids = new Set<string>();
  for (const e of events) {
    for (const p of ["UID", "DTSTAMP", "DTSTART", "DTEND", "SUMMARY"]) if (!e.props[p]) errors.push(`event missing ${p}`);
    const uid = e.props.UID?.[0];
    if (uid) { if (uids.has(uid)) errors.push(`duplicate UID ${uid}`); uids.add(uid); }
    const s = e.props.DTSTART?.[0], en = e.props.DTEND?.[0];
    if (s && en && !(/^\d{8}$/.test(s) && /^\d{8}$/.test(en) && en > s)) errors.push(`bad DTSTART/DTEND ${s} ${en}`);
    if (e.props.DTSTAMP && !/^\d{8}T\d{6}Z$/.test(e.props.DTSTAMP[0])) errors.push("bad DTSTAMP");
  }
  return { events, errors };
}
