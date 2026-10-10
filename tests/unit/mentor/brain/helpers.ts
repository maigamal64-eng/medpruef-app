/**
 * Synthetic fixtures for the W2-BRAIN tests. Every date is in 2099 and every
 * fee is odd on purpose: none of these is a real exam fact.
 */
import type { OfficialSitting } from "@/lib/exam-dates";
import { MentorFactsLoader } from "@/lib/mentor/facts-loader";
import type { MentorFact, TurnContext } from "@/lib/mentor/seam";
import type { MentorDb } from "@/lib/mentor/tools/run";

export const NOW = new Date("2099-01-10T10:00:00Z");

export function fact(over: Partial<MentorFact> & { id: string }): MentorFact {
  return {
    exam_key: "sip5a",
    topic: "format",
    filing_university: "all",
    text_de: "Synthetischer Testfakt.",
    text_en: "Synthetic test fact.",
    aliases: [],
    source_url: "https://example.org/fixture",
    source_label: "Fixture Office",
    edition: "fixture",
    read_on: "2099-01-01",
    verdict: "confirmed",
    review_every_days: 30,
    status: "live",
    ...over,
  };
}

export const FACTS: MentorFact[] = [
  fact({
    id: "fixture.fee.sip5a",
    topic: "fee",
    text_de: "Die Prüfungsgebühr beträgt 777 EUR.",
    text_en: "The exam fee is 777 EUR.",
    aliases: ["Gebühr", "Kosten", "fee", "сбор"],
  }),
  fact({
    id: "fixture.format.sip5a",
    topic: "format",
    text_de: "Die Prüfung hat 123 Fragen und dauert 4 Stunden.",
    text_en: "The exam has 123 questions and lasts 4 hours.",
    aliases: ["Fragenanzahl", "Format"],
  }),
  fact({
    id: "fixture.pass.sip5a",
    topic: "pass_rule",
    text_de: "Bestanden ist ab 63 % richtiger Antworten.",
    text_en: "The pass mark is 63 % correct answers.",
    aliases: ["Bestehensgrenze", "pass mark"],
  }),
  fact({
    id: "fixture.dates.sip5a",
    topic: "dates",
    text_de: "Die Anmeldung endet am 2099-03-18 um 12:00.",
    text_en: "Registration closes on 2099-03-18 at 12:00.",
  }),
  fact({
    id: "fixture.partly.sip5a",
    topic: "attempts",
    verdict: "partly",
    text_de: "Es gibt 9 Antritte.",
    text_en: "There are 9 attempts.",
    aliases: ["Antritte", "Versuche", "attempts"],
  }),
  fact({
    id: "fixture.expired.sip5a",
    topic: "results",
    valid_until: "2099-01-05",
    text_de: "Ergebnisse nach 5 Tagen.",
    text_en: "Results after 5 days.",
    aliases: ["Ergebnis"],
  }),
  fact({
    id: "fixture.general.glossary",
    exam_key: "general",
    topic: "glossary",
    text_de: "Nostrifizierung ist die Anerkennung eines ausländischen Studienabschlusses.",
    text_en: "Nostrifizierung is the recognition of a foreign degree.",
    aliases: ["Nostrifikation", "Anerkennung"],
  }),
];

export const SITTINGS: OfficialSitting[] = [
  {
    exam_key: "sip5a",
    learner_label: { de: "SIP5a (Fixture)", en: "SIP5a (Fixture)" },
    date: "2099-04-20",
    registration_opens: "2099-02-01",
    registration_closes: "2099-03-18",
    deadline_type: "registration",
    publisher: "Fixture Uni Wien",
    filing_university: "wien",
    source_url: "https://example.org/sip-calendar",
    read_on: "2099-01-01",
  },
  {
    exam_key: "stichprobentest",
    learner_label: { de: "Stichprobentest Fixture", en: "Stichprobentest Fixture" },
    date: "2099-05-06",
    registration_opens: null,
    registration_closes: "2099-03-02",
    deadline_type: "filing_cutoff",
    publisher: "Fixture Uni Wien",
    filing_university: "wien",
    source_url: "https://example.org/merkblatt",
    read_on: "2099-01-01",
  },
  {
    exam_key: "stichprobentest",
    learner_label: { de: "Stichprobentest Fixture", en: "Stichprobentest Fixture" },
    date: "2099-05-06",
    registration_opens: null,
    registration_closes: "2099-03-25",
    deadline_type: "registration",
    publisher: "Fixture Uni Innsbruck",
    filing_university: "innsbruck",
    source_url: "https://example.org/imed",
    read_on: "2099-01-01",
  },
  {
    exam_key: "sip4a",
    learner_label: { de: "SIP4a (Fixture, past)", en: "SIP4a (Fixture, past)" },
    date: "2098-11-11",
    registration_opens: "2098-09-01",
    registration_closes: "2098-10-01",
    deadline_type: "registration",
    publisher: "Fixture Uni Wien",
    filing_university: "wien",
    source_url: "https://example.org/sip-calendar",
    read_on: "2098-08-01",
  },
];

export function makeLoader(records: unknown[] = FACTS, sittings: OfficialSitting[] = SITTINGS, log?: (m: string) => void): MentorFactsLoader {
  return new MentorFactsLoader({
    files: () => ({ files: [{ file: "fixture.json", records }], errors: [] }),
    sittings,
    appFacts: () => [],
    log: log ?? (() => {}),
  });
}

export function ctx(over: Partial<TurnContext> = {}): TurnContext {
  return {
    userId: "11111111-1111-4111-8111-111111111111",
    requestId: "22222222-2222-4222-8222-222222222222",
    lang: "de",
    mode: "facts",
    now: NOW,
    paidAccess: true,
    ...over,
  };
}

/** Chainable fake of the Supabase query builder: records calls, resolves to the configured result per table. */
export interface FakeCall {
  table: string;
  select?: string;
  filters: Array<[string, string, unknown]>;
}

export function fakeDb(results: Record<string, { data: unknown; error?: unknown }>): { db: MentorDb; calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const db = {
    from(table: string) {
      const call: FakeCall = { table, filters: [] };
      calls.push(call);
      const res = results[table] ?? { data: null };
      const builder: Record<string, unknown> = {
        select(cols: string) {
          call.select = cols;
          return builder;
        },
        eq(col: string, val: unknown) {
          call.filters.push(["eq", col, val]);
          return builder;
        },
        order() {
          return builder;
        },
        limit() {
          return Promise.resolve({ data: res.data, error: res.error ?? null });
        },
        maybeSingle() {
          return Promise.resolve({ data: res.data, error: res.error ?? null });
        },
      };
      return builder;
    },
  };
  return { db: db as unknown as MentorDb, calls };
}
