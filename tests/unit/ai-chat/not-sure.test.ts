/**
 * TR-30: the legacy AI explanation chat never invents sources. Five follow-up
 * questions ask for facts the bank row does not hold; the mocked model answers
 * with the kinds of invented citations a general model produces. The route must
 * return "not sure" text without the citation, and cache only the guarded text.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, type FakeCall, type FakeResult } from "../helpers/fake-supabase";
import { guardCitations, isCitation, NOT_SURE_NOTE } from "@/lib/ai/citation-guard";

const { requireUser, isFreeAccess, world } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  isFreeAccess: vi.fn(),
  world: { sb: null as unknown },
}));

vi.mock("@/lib/auth-guard", () => ({ requireUser, isFreeAccess, isPaidAccess: vi.fn(() => true) }));
vi.mock("@/lib/free-access", () => ({
  canFreeUserReadQuestion: vi.fn(async () => true),
  logFreeCapHit: vi.fn(async () => undefined),
}));
vi.mock("@/lib/supabase", () => ({ getServiceClient: () => world.sb }));
vi.mock("@/lib/sentry-capture", () => ({ addBreadcrumb: vi.fn(), captureServerError: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true, retryAfterSec: 0 })),
  rateKey: vi.fn(() => "test-key"),
  rateLimitHeaders: vi.fn(() => ({})),
}));

const UID = "11111111-1111-4111-8111-111111111111";

function setup() {
  const cacheWrites: Record<string, unknown>[] = [];
  const { sb } = createFakeSupabase((call: FakeCall): FakeResult | undefined => {
    if (call.table === "rpc:ai_quota_take") return { data: { ok: true, used: 1 } };
    if (call.table === "rpc:ai_legacy_cost_month") return { data: 0 };
    if (call.table === "ai_call_log") return call.op === "select" ? { data: [] } : {};
    if (call.table === "questions") {
      if (call.op === "select") {
        return {
          data: {
            question: "Welches Organ produziert Insulin?",
            answer: "Pankreas",
            explanation: "Beta-Zellen der Langerhans-Inseln.",
            topic: "Endokrinologie",
            choices: [{ text: "Pankreas", correct: true }, { text: "Leber", correct: false }],
            ai_explanation: null,
            key_revision: 0,
            ai_explanation_lang: null,
          },
        };
      }
      if (call.op === "update") {
        cacheWrites.push({ ...(call.payload as Record<string, unknown>) });
        return { data: { id: 42 } };
      }
    }
    return {};
  });
  world.sb = sb;
  return { cacheWrites };
}

function modelSays(text: string) {
  const seen: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    seen.push(body);
    if (!url.includes("api.anthropic.com")) throw new Error(`unexpected fetch ${url}`);
    return new Response(JSON.stringify({
      id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-5",
      content: [{ type: "text", text }], stop_reason: "end_turn",
      usage: { input_tokens: 900, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    }), { status: 200, headers: { "content-type": "application/json", "request-id": "req_1" } });
  }));
  return seen;
}

async function ask(content: string, lang: "de" | "en" = "de") {
  const { POST } = await import("@/app/api/ai-chat/route");
  return POST(new NextRequest("https://example.test/api/ai-chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ questionId: 42, lang, messages: [{ role: "user", content }] }),
  }));
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ userId: UID, tier: "pro", role: "user" });
  isFreeAccess.mockReturnValue(false);
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("AI_PRIMARY_MODEL", "claude-sonnet-5");
  vi.stubEnv("AI_FEATURES_ENABLED", "true");
  vi.stubEnv("AI_PROVIDER_MODE", "auto");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// Five facts the bank row does not hold, each answered by the mock with an invented source.
const CASES: { ask: string; model: string; lang: "de" | "en"; keeps: string }[] = [
  {
    ask: "Welche Leitlinie empfiehlt das, und aus welchem Jahr?",
    model: "**TL;DR** Insulin kommt aus dem Pankreas.\n- Beta-Zellen schütten Insulin aus.\n- Laut ESC-Leitlinie 2023 ist das Standard.",
    lang: "de",
    keeps: "Beta-Zellen schütten Insulin aus.",
  },
  {
    ask: "Wo kann ich das nachlesen?",
    model: "Das Pankreas bildet Insulin in den Beta-Zellen.\n\n**Quellen:**\n- https://example.org/insulin\n- Herold Innere Medizin 2024",
    lang: "de",
    keeps: "Das Pankreas bildet Insulin in den Beta-Zellen.",
  },
  {
    ask: "Which study showed this?",
    model: "Beta cells release insulin. This was shown by Banting et al. in a landmark paper.",
    lang: "en",
    keeps: "Beta cells release insulin.",
  },
  {
    ask: "Wie viele Kandidaten bestehen diese Frage?",
    model: "Die Beta-Zellen sind entscheidend. Nach Daten aus PubMed (PMID 1234567) liegt die Quote bei 61 Prozent.",
    lang: "de",
    keeps: "Die Beta-Zellen sind entscheidend.",
  },
  {
    ask: "Gibt es dazu eine österreichische Empfehlung?",
    model: "Da bin ich nicht sicher. Die Frage und ihre Erklärung enthalten dazu keine Angabe. Sicher ist: Das Pankreas bildet Insulin.",
    lang: "de",
    keeps: "Da bin ich nicht sicher.",
  },
];

describe("TR-30 legacy AI chat: not sure instead of an invented source", () => {
  it("tells the model its only sources and to say it is not sure", async () => {
    setup();
    const seen = modelSays("Das Pankreas bildet Insulin.");
    await ask("Erkläre diese Frage.");
    const system = (seen[0].system as { text: string }[])[0].text;
    expect(system).toContain("Your only sources are the question, its choices, the keyed answer and the stored explanation");
    expect(system).toContain("Da bin ich nicht sicher.");
    expect(system).toContain("address the learner formally with Sie");
  });

  for (const [i, c] of CASES.entries()) {
    it(`case ${i + 1}: ${c.ask}`, async () => {
      const t = setup();
      modelSays(c.model);
      const res = await ask(c.ask, c.lang);
      expect(res.status).toBe(200);
      const { reply } = (await res.json()) as { reply: string };
      expect(reply).toContain(c.keeps);
      expect(reply).not.toMatch(/https?:\/\/|et al\.|PMID|PubMed|Quellen?:|ESC-Leitlinie 2023|Herold Innere Medizin 2024/);
      const invented = c.model !== guardCitations(c.model, c.lang).text;
      if (invented) {
        expect(reply).toContain(NOT_SURE_NOTE[c.lang]);
      } else {
        expect(reply).toBe(c.model);
      }
      // The first turn is cached; the cache never keeps an invented source.
      for (const w of t.cacheWrites) expect(String(w.ai_explanation)).toBe(reply);
    });
  }
});

describe("citation guard", () => {
  it("keeps ordinary medical content with numbers and named concepts", () => {
    const text = "**TL;DR** Ein Kalium über 6,5 mmol/l ist gefährlich.\n- Das WHO-Stufenschema ordnet Analgetika.\n- 2 von 3 Kriterien reichen.";
    expect(guardCitations(text, "de")).toEqual({ text, removed: 0 });
  });

  it("flags edition-style references and leaves plain years alone", () => {
    expect(isCitation("Die ERC 2021 Empfehlung lautet so.")).toBe(true);
    expect(isCitation("(Smith, 2020)")).toBe(true);
    expect(isCitation("Seit 2020 ist das Medikament zugelassen.")).toBe(false);
  });

  it("drops a whole source list and the bullets under it", () => {
    const out = guardCitations("Kernaussage bleibt.\n\nQuellen:\n- Buch A\n- Buch B\n\nNoch ein Satz.", "de");
    expect(out.text).toContain("Kernaussage bleibt.");
    expect(out.text).toContain("Noch ein Satz.");
    expect(out.text).not.toMatch(/Buch A|Buch B|Quellen:/);
    expect(out.removed).toBe(3);
  });

  it("keeps doses, volumes and abbreviations that sit near a body name (review P2)", () => {
    for (const text of [
      "Die Empfehlung lautet 2000 IE Vitamin D täglich.",
      "Laut WHO liegt der Zielwert bei 2000 kcal.",
      "Initial 1000 ml, dann 2000 ml über 24 h laut ERC.",
      "Das Statement der Gruppe: Dosis 2000 mg.",
      "| Metformin | 2000 mg (ADA) |",
      "Paracetamol max. 4000 mg/Tag. Danach Pause.",
    ]) expect(guardCitations(text, "de")).toEqual({ text, removed: 0 });
  });

  it("drops a cited table row whole and never splits after an abbreviation", () => {
    const out = guardCitations("| Wert | Quelle |\n| HbA1c | ESC-Leitlinie 2023 |\nGabe z.B. Dr. Meier folgend.", "de");
    expect(out.text).toContain("| Wert | Quelle |");
    expect(out.text).not.toContain("ESC-Leitlinie 2023");
    expect(out.text).toContain("Gabe z.B. Dr. Meier folgend.");
  });

  it("stays linear on hostile output (review P1 ReDoS)", () => {
    const hostile = ["(" + "A".repeat(5000), "(" + "Ab ".repeat(2000), "ESC " + "x".repeat(5000), "x".repeat(20000)].join("\n");
    const start = performance.now();
    guardCitations(hostile, "de");
    expect(performance.now() - start).toBeLessThan(200);
  });
});

