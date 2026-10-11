/** One owner for runtime fact tracing, also inspected by the readiness card. */
export const MENTOR_FACT_TRACE: Record<string,string[]> = {
 "/api/mentor/chat": ["./content/mentor-facts/**/*"],
 "/api/mentor/admin/operations": ["./content/mentor-facts/**/*"],
};
/** No passing live eval has been attested for the integrated R2 candidate. track-A records evidence after its live run. */
export const MENTOR_RELEASE_EVAL: { commit: string; score: string; passed_at: string } | null = null;
