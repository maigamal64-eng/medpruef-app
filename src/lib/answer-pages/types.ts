import type { OfficialExamKey } from "@/lib/exam-dates";
import type { ExamSourceId } from "@/lib/topics";

export type AnswerLang = "de" | "en";
export type Bilingual = { de: string; en: string };

/** A predicate the page or an FAQ item needs before it may render. */
export type AnswerCondition = "mentor_public_copy" | "referral_mentor_credits";

export interface AnswerSource {
  url: string;
  label: string;
  edition: string;
  read_on: string;
  sha256: string | null;
}

/** One checked statement: the text the page relies on and where it is official. */
export interface AnswerClaim {
  id: string;
  /** Source id in the sources map, or "product" for a fact owned by MedPrüf code. */
  source_id: string;
  status: "official" | "not_confirmed" | "product";
  /** The supporting sentence as printed in the source (original language). */
  quote: string;
}

export interface AnswerLink {
  href: string;
  label: Bilingual;
}

export interface AnswerSection {
  heading: Bilingual;
  paragraphs: Bilingual[];
  /** Ordered list items, rendered after the paragraphs. */
  steps?: Bilingual[];
  links?: AnswerLink[];
  claims: string[];
}

export type AnswerFaq =
  | { kind: "text"; q: Bilingual; a: Bilingual; claims: string[]; when?: AnswerCondition }
  /** Answered by code from OFFICIAL_SITTINGS on every request, never by copy. */
  | { kind: "next_sitting"; exam: OfficialExamKey };

export interface AnswerPage {
  id: string;
  /** URL segment under /blog. German, stable once published. */
  slug: string;
  /** Question bank the free-sample link opens. */
  bank: ExamSourceId;
  /** Exams whose next official sitting leads the page, in display order. */
  exams: OfficialExamKey[];
  requires?: AnswerCondition[];
  /** Question-shaped page title (the h1). */
  title: Bilingual;
  /** Meta description, at most 160 characters. */
  description: Bilingual;
  /** The short answer right under the lead, two to four sentences. */
  answer: Bilingual;
  answer_claims: string[];
  sections: AnswerSection[];
  faq: AnswerFaq[];
  /** Existing deeper pages this page points to. */
  related: string[];
  claims: AnswerClaim[];
  /** ISO date the content was last checked against its sources. */
  checked_on: string;
  /** Excluded from llms.txt (the mentor product stays out of agent files, a39). */
  llms?: false;
}

export interface AnswerPagesData {
  schemaVersion: 1;
  sources: Record<string, AnswerSource>;
  pages: AnswerPage[];
}
