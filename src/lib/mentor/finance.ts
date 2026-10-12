import { CREDIT_MICRO_USD } from "./config";
export interface MentorFinanceModel {
 creditMicroUsd: number;
 /** Whop fee per charge, recorded only after it is checked against the Whop account (MUX-98). */
 whopFee: { fixedEurCents: number; percent: number; verifiedAt: string; evidence: string } | null;
 /** USD per 1 EUR, recorded with its source; cost is micro-USD, revenue is EUR. */
 usdPerEur: { value: number; verifiedAt: string; evidence: string } | null;
}
/** SOT-REF: src/lib/mentor/config.ts CREDIT_MICRO_USD. Fee evidence belongs here after account verification. */
export const MENTOR_FINANCE_MODEL: Readonly<MentorFinanceModel> = Object.freeze({
 creditMicroUsd: CREDIT_MICRO_USD,
 whopFee: null,
 usdPerEur: null,
});
export function mentorMarginDisplayAllowed(model: Readonly<MentorFinanceModel> = MENTOR_FINANCE_MODEL): boolean {
 const { whopFee, usdPerEur } = model;
 return !!whopFee?.verifiedAt && !!whopFee.evidence && !!usdPerEur?.verifiedAt && !!usdPerEur.evidence && usdPerEur.value > 0;
}
