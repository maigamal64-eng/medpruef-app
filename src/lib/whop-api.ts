/**
 * Whop API version pin and money reader (a-whop-api-version-pin, review G7).
 * Dependency-free so any Whop caller (app or script) can import it.
 *
 * Whop answers each request in the shape of the Api-Version-Date header, or,
 * without it, in the version pinned on the API key. Keys created today pin
 * the newest version, where payment amounts are money objects (2026-09-02-1,
 * Native Payments). Every parser here was written for the original version,
 * 2025-01-01, which the production key serves today (a read-only GET /plans
 * answered `api-version-date: 2025-01-01` on 16 Oct 2026). Sending the pin on
 * every call keeps that shape when the key is rotated. Raise it only after
 * reading every changelog entry between the two versions
 * (https://docs.whop.com/developer/api/versioning).
 */
export const WHOP_API_VERSION_DATE = "2025-01-01";

const RESERVED = new Set(["authorization", "accept", "api-version-date"]);

/**
 * Headers for every Whop API call: bearer key, JSON, and the version pin.
 * `extra` adds headers (Content-Type, Idempotency-Key) but can never replace
 * or join the key, Accept or the pin, in any letter case.
 */
export function whopHeaders(apiKey: string, extra: Record<string, string> = {}): Record<string, string> {
  const kept = Object.fromEntries(Object.entries(extra).filter(([k]) => !RESERVED.has(k.toLowerCase())));
  return {
    ...kept,
    Authorization: `Bearer ${apiKey}`,
    Accept: "application/json",
    "Api-Version-Date": WHOP_API_VERSION_DATE,
  };
}

/**
 * A Whop amount in major units, from any shape Whop has used: a number
 * (2025-01-01), a numeric string, or a money object
 * `{ amount, currency, decimals, display_decimals }` (2026-09-02-1), whose
 * `amount` is an exact major-unit decimal string ("19.00" is 19 EUR, per
 * @whop/sdk Money.d.ts). `decimals` is the charge precision, not a scale, so
 * it is never applied. null when nothing readable is there.
 */
export function whopMoneyMajor(v: unknown): number | null {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    if (!("amount" in v)) return null;
    v = (v as Record<string, unknown>).amount;
    if (v && typeof v === "object") return null;
  }
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** whopMoneyMajor in cents (two decimal places, as every MedPrüf price). */
export function whopMoneyCents(v: unknown): number | null {
  const n = whopMoneyMajor(v);
  return n === null ? null : Math.round(n * 100);
}
