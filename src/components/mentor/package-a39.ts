import type { MentorPackageOffer } from "@/lib/mentor/contract";
import type { MentorUiLang } from "@/lib/i18n-mentor";
import { a39T } from "./a39-copy";

/**
 * MUX-73: one plain sentence on renewal and expiry, read from the package row
 * (period_days, valid_days), never typed. The grace it states was proved on
 * the real ledger SQL (tests/unit/mentor/credits/grace-pg.test.ts): unused
 * credits stay usable until valid_days after the grant, then expire, no rollover.
 */
export function renewalGraceText(o: Pick<MentorPackageOffer, "kind" | "period_days" | "valid_days">, lang: MentorUiLang): string | null {
  if (o.kind !== "subscription" || !o.period_days || o.period_days <= 0 || !Number.isFinite(o.valid_days)) return null;
  const grace = Math.round(o.valid_days - o.period_days);
  if (grace <= 0) return a39T("renew_no_grace", lang, { period: o.period_days });
  return a39T(grace === 1 ? "renew_grace_one" : "renew_grace", lang, { period: o.period_days, grace });
}
