// Captures client-side context for user reports (flags, feedback, edits).
// Used so that even anonymous/guest submissions have enough signal to triage.

export interface ClientContext {
  url: string | null;
  referrer: string | null;
  user_agent: string | null;
  screen: string | null;
  viewport: string | null;
  language: string | null;
  lang_pref: string | null;
  exam_type: string | null;
  active_exam: string | null;
  question_id: number | null;
  session_user_id: string | null;
  session_first_name: string | null;
  build_id: string | null;
  timestamp: string;
}

export function captureClientContext(
  overrides: Partial<ClientContext> = {}
): ClientContext {
  if (typeof window === "undefined") {
    return {
      url: null,
      referrer: null,
      user_agent: null,
      screen: null,
      viewport: null,
      language: null,
      lang_pref: null,
      exam_type: null,
      active_exam: null,
      question_id: null,
      session_user_id: null,
      session_first_name: null,
      build_id: null,
      timestamp: new Date().toISOString(),
      ...overrides,
    };
  }

  let sessionUserId: string | null = null;
  let sessionFirstName: string | null = null;
  let activeExam: string | null = null;
  let langPref: string | null = null;

  try {
    const raw = localStorage.getItem("medpruef_session");
    if (raw) {
      const sess = JSON.parse(raw);
      sessionUserId = sess?.user?.id || null;
      sessionFirstName = sess?.user?.first_name || null;
      activeExam = sess?.user?.active_exam || null;
    }
    activeExam = activeExam || localStorage.getItem("medpruef_active_exam");
    // NOTE: the key is `medpruef-lang` (dash), not `medpruef_lang`
    // (underscore). The rest of the codebase (i18n.ts, Onboarding.tsx)
    // writes the dash variant; reading the underscore variant meant
    // lang_pref was null in every flag/feedback submission since the
    // context-capture shipped. Fixed 2026-04-15 (Frontend audit P1-4).
    langPref = localStorage.getItem("medpruef-lang");
  } catch {
    /* localStorage unavailable */
  }

  return {
    url: window.location.href,
    referrer: document.referrer || null,
    user_agent: navigator.userAgent || null,
    screen: `${window.screen.width}x${window.screen.height}`,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    language: navigator.language || null,
    lang_pref: langPref,
    exam_type: activeExam,
    active_exam: activeExam,
    question_id: null,
    session_user_id: sessionUserId,
    session_first_name: sessionFirstName,
    build_id:
      (window as unknown as { __MEDPRUEF_BUILD_ID__?: string }).__MEDPRUEF_BUILD_ID__ ||
      process.env.NEXT_PUBLIC_BUILD_ID ||
      null,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}
