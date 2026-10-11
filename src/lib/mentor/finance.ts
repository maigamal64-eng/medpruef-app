import { CREDIT_MICRO_USD } from "./config";
/** SOT-REF: src/lib/mentor/config.ts CREDIT_MICRO_USD. Fee evidence belongs here after account verification. */
export const MENTOR_FINANCE_MODEL = Object.freeze({
 creditMicroUsd: CREDIT_MICRO_USD,
 whopFee: null as { fixedEurCents: number; percent: number; verifiedAt: string; evidence: string } | null,
 usdPerEur: null as { value: number; verifiedAt: string; evidence: string } | null,
});
export function mentorMarginDisplayAllowed(): boolean {
 const { whopFee, usdPerEur } = MENTOR_FINANCE_MODEL;
 return !!whopFee?.verifiedAt && !!whopFee.evidence && !!usdPerEur?.verifiedAt && !!usdPerEur.evidence;
}
