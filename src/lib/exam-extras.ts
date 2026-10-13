import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase";
import raw from "./guidance-data/exam-extras.data.json";
import { BANK_CACHE_SECONDS, BANK_CACHE_TAGS } from "@/lib/bank-cache-tags";

export type ExtraLanguage = "de" | "en";
export type Localized = Record<ExtraLanguage, string>;
export type ExtraPage = keyof typeof raw.pages;
export type ExtraFact = (typeof raw.facts)[number];
export const EXAM_EXTRAS = raw;
export const EXTRA_PAGES = Object.keys(raw.pages) as ExtraPage[];
export const PRACTICE_BANKS = Object.keys(raw.bankLabels) as (keyof typeof raw.bankLabels)[];
export function extraFacts(page: ExtraPage): ExtraFact[] {
  return raw.facts.filter((fact) => raw.pages[page].factIds.includes(fact.id));
}
export function extraLanguage(value: string | string[] | undefined): ExtraLanguage {
  return value === "en" ? "en" : "de";
}
export interface InventoryRow { id: number; exam_type: string; topic: string | null; choices: unknown }
export interface TopicInventory { topic: string; active: number; mc: number }
export interface BankInventory {
  active: number; mc: number; withoutMc: number; sipShape: number; outsideSipShape: number; topics: TopicInventory[];
}
export interface PracticeInventory {
  status: "available" | "unavailable";
  checkedAt: string;
  banks: Record<string, BankInventory>;
}
/** Only counts cross this boundary. Choice text, answer keys and ids are never returned. */
export function aggregateInventory(rows: readonly InventoryRow[], checkedAt: string): PracticeInventory {
  const banks: Record<string, BankInventory> = Object.fromEntries(PRACTICE_BANKS.map((key) => [key, { active: 0, mc: 0, withoutMc: 0, sipShape: 0, outsideSipShape: 0, topics: [] }]));
  for (const row of rows) {
    const bank = banks[row.exam_type];
    if (!bank) continue;
    const topicName = row.topic?.trim() || "";
    let topic = bank.topics.find((entry) => entry.topic === topicName);
    if (!topic) { topic = { topic: topicName, active: 0, mc: 0 }; bank.topics.push(topic); }
    bank.active++; topic.active++;
    const choices = Array.isArray(row.choices) ? row.choices : [];
    const shaped = choices.length >= 2 && choices.every((choice: unknown) => typeof choice === "object" && choice !== null && "text" in choice && typeof choice.text === "string" && choice.text.trim().length > 0 && "correct" in choice && typeof choice.correct === "boolean");
    const correct = choices.filter((choice: unknown) => typeof choice === "object" && choice !== null && "correct" in choice && choice.correct === true).length;
    if (!shaped || correct < 1 || correct >= choices.length) { bank.withoutMc++; continue; }
    bank.mc++; topic.mc++;
    if (choices.length === 5 && correct <= 3) bank.sipShape++;
    else bank.outsideSipShape++;
  }
  for (const bank of Object.values(banks)) bank.topics.sort((a, b) => a.topic.localeCompare(b.topic, "de-AT"));
  return { status: "available", checkedAt, banks };
}
/**
 * Paginate beyond PostgREST's row cap and reject partial reads rather than publishing false totals.
 * Throws on any failure (a-db-relief-1): the cached reader below must never keep "unavailable".
 */
export async function readPracticeInventoryOrThrow(): Promise<PracticeInventory> {
  const checkedAt = new Date().toISOString();
  const client = getServiceClient();
  const signal = AbortSignal.timeout(30_000);
  const rows: InventoryRow[] = [];
  let expected: number | null = null;
  let cursor = 0;
  while (rows.length <= 50_000) {
    let query = client.from("questions").select("id,exam_type,topic,choices", { count: "exact" }).eq("is_active", true).in("exam_type", PRACTICE_BANKS).order("id").limit(1000);
    if (cursor) query = query.gt("id", cursor);
    const { data, count, error } = await query.abortSignal(signal);
    if (error || !Array.isArray(data) || count === null) throw new Error("Inventory read unavailable");
    if (expected === null) expected = count;
    // The exact count of the remaining cursor slice catches changes and configured row caps.
    if (rows.length + count !== expected) throw new Error("Inventory changed during read");
    const batch = data as InventoryRow[];
    if (!batch.length) break;
    for (const row of batch) {
      if (!Number.isSafeInteger(row.id) || row.id <= cursor) throw new Error("Invalid inventory order");
      cursor = row.id; rows.push(row);
    }
    if (rows.length === expected) break;
  }
  if (expected === null || rows.length !== expected) throw new Error("Incomplete inventory");
  return aggregateInventory(rows, checkedAt);
}
/** Uncached read; a failure reads as "unavailable". */
export async function readPracticeInventory(): Promise<PracticeInventory> {
  try {
    return await readPracticeInventoryOrThrow();
  } catch {
    return { status: "unavailable", checkedAt: new Date().toISOString(), banks: {} };
  }
}
// a-db-relief-1 (T0b): 24 h under its own tag (purged by the admin question
// editor); a failed read throws inside the cache and is never kept.
const cachedInventory = unstable_cache(readPracticeInventoryOrThrow, ["exam-extras-inventory-v2"], { revalidate: BANK_CACHE_SECONDS, tags: [BANK_CACHE_TAGS.inventory] });
export async function getPracticeInventory(): Promise<PracticeInventory> {
  try {
    return await cachedInventory();
  } catch {
    return { status: "unavailable", checkedAt: new Date().toISOString(), banks: {} };
  }
}
export function subjectPracticeCount(subjectId: string, inventory: PracticeInventory, bank: string): number | null {
  if (inventory.status !== "available") return null;
  const subject = raw.subjectMap.find((entry) => entry.id === subjectId);
  if (!subject || !inventory.banks[bank]) return null;
  return inventory.banks[bank].topics.filter((topic) => subject.practiceTopics.includes(topic.topic)).reduce((sum, topic) => sum + topic.active, 0);
}
export function unmappedTopics(inventory: PracticeInventory, bank: string): TopicInventory[] {
  const mapped = new Set(raw.subjectMap.flatMap((subject) => subject.practiceTopics));
  return (inventory.banks[bank]?.topics ?? []).filter((topic) => !mapped.has(topic.topic));
}
