/**
 * Europe/Vienna calendar month boundary. Shared by the referral credit caps
 * and the free credit breakers (a-free-credit-hooks). No I/O.
 */

/** UTC instant of the first moment of the Europe/Vienna calendar month containing `now`. */
export function viennaMonthStart(now: Date): Date {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Vienna", year: "numeric", month: "2-digit" }).formatToParts(now);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  // Vienna is UTC+1 or UTC+2; resolve local midnight of day 1 to UTC.
  const guess = Date.UTC(year, month - 1, 1);
  const offsetAt = (ms: number) => {
    const f = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Vienna", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms));
    const g = (t: string) => Number(f.find((p) => p.type === t)?.value);
    return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute")) - ms;
  };
  let start = guess - offsetAt(guess);
  start = guess - offsetAt(start);
  return new Date(start);
}
