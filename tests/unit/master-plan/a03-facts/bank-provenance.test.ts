import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import data from "@/lib/guidance-data/bank-provenance.data.json";
import { BANK_SOURCES, overdueSources, reviewDueOn } from "@/lib/bank-provenance";

const root = resolve(__dirname, "../../../..");
const ledger = readFileSync(resolve(root, "docs/content/question-sources.md"), "utf8");
const sot = readFileSync(resolve(root, "MEDPRUF-SOT.md"), "utf8");
const today = () => new Date().toISOString().slice(0, 10);

describe("bank provenance record (CNT-11, TR-05, pick-bank-provenance A)", () => {
  it("has exactly one record per source_file row in the ledger table", () => {
    const ledgerRows = [...ledger.matchAll(/^\| `([A-Z0-9_a-z]+)` \| ([\d,]+) \|/gm)].map((m) => [m[1], Number(m[2].replace(/,/g, ""))]);
    expect(ledgerRows.length).toBe(7); // a44 added the inactive Gerichtsmedizin source (0 rows at the snapshot)
    expect(BANK_SOURCES.map((s) => [s.source_file, s.active_rows_at_snapshot]).sort()).toEqual([...ledgerRows].sort());
    expect(BANK_SOURCES.reduce((n, s) => n + s.active_rows_at_snapshot, 0)).toBe(data.snapshot.active_rows_total);
  });

  it("every bank lists only its own sources and every source belongs to one bank", () => {
    const listed = Object.entries(data.banks).flatMap(([bank, b]) => b.sources.map((s) => [s, bank]));
    expect(listed.length).toBe(BANK_SOURCES.length);
    for (const [s, bank] of listed) expect(BANK_SOURCES.find((r) => r.source_file === s)?.exam_type).toBe(bank);
  });

  it("no record is past its review date today (re-review, then bump reviewed_on in both files)", () => {
    const overdue = overdueSources(today()).map((s) => `${s.source_file} reviewed ${s.reviewed_on}, due ${reviewDueOn(s)}`);
    expect(overdue).toEqual([]);
  });

  it("the staleness check fires the day after the due day, not on it", () => {
    const s = { ...BANK_SOURCES[0], reviewed_on: "2026-10-12", review_every_days: 90 };
    expect(reviewDueOn(s)).toBe("2027-01-10");
    expect(overdueSources("2027-01-10", [s])).toEqual([]);
    expect(overdueSources("2027-01-11", [s]).map((r) => r.source_file)).toEqual([s.source_file]);
  });

  it("records are dated, not in the future, and no rights status claims clearance without a basis", () => {
    for (const s of BANK_SOURCES) {
      expect(s.reviewed_on).toMatch(/^20\d\d-\d\d-\d\d$/);
      expect(s.reviewed_on <= today()).toBe(true);
      expect(s.review_every_days).toBeGreaterThan(0);
      if (s.rights_status === "cleared") expect(s.rights_basis).not.toMatch(/^None/);
    }
  });

  it("the KoalaMed rows carry [name]'s dated decision: kept as practice material, no refresh from the closed source", () => {
    const koala = BANK_SOURCES.filter((s) => s.source_file.startsWith("KOALAMED_"));
    expect(koala.length).toBe(3);
    for (const s of koala) {
      expect(s.decision).toMatchObject({ ref: "pick-koalamed", by: "[name]", on: "2026-10-11" });
      expect(s.refresh_path).toMatch(/^None from KoalaMed/);
    }
    expect(ledger).not.toMatch(/pending [name] \(TR-05\)/);
    expect(sot).toMatch(/Innsbruck \(Stichprobentest\) bank decision \(TR-05 \/ CNT-11, [name] 2026-10-11/);
  });

  it("public descriptions never call a bank official exam questions", () => {
    for (const bank of Object.values(data.banks)) {
      for (const text of Object.values(bank.public_description)) expect(text).not.toMatch(/(?<!keine |not )(offizielle|official)/i);
    }
  });
});
