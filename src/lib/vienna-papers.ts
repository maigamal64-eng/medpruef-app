/**
 * Practise by official Vienna paper (CNT-12). Pure.
 *
 * SIP4a and SIP5a are different papers sat on different days. The mapping is
 * by topic only (VIENNA_EXAM_PARTS): every active Vienna row has exactly one
 * topic and every Vienna topic belongs to exactly one paper. Never keyed on
 * tags (sip4a/sip5a tags cover only a minority of rows).
 */
import { VIENNA_EXAM_PARTS } from "@/lib/topics";

export type ViennaPaper = "sip4" | "sip5";
export const VIENNA_PAPERS: ViennaPaper[] = ["sip4", "sip5"];

export function paperOfTopic(topic: string): ViennaPaper | null {
  for (const paper of VIENNA_PAPERS) if (VIENNA_EXAM_PARTS[paper].includes(topic)) return paper;
  return null;
}

/** The topics of `paper` that exist in the loaded bank (keeps the builder honest about counts). */
export function paperTopics(paper: ViennaPaper, available: readonly string[]): string[] {
  return VIENNA_EXAM_PARTS[paper].filter((topic) => available.includes(topic));
}

/** Which paper a topic selection is exactly equal to, if any. */
export function paperOfSelection(selected: ReadonlySet<string>, available: readonly string[]): ViennaPaper | null {
  for (const paper of VIENNA_PAPERS) {
    const topics = paperTopics(paper, available);
    if (topics.length > 0 && topics.length === selected.size && topics.every((topic) => selected.has(topic))) return paper;
  }
  return null;
}
