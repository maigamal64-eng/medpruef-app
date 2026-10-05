import { describe, expect, it } from "vitest";
import { getStreakSuffix } from "@/components/HomeStatStrip";

describe("home streak unit labels", () => {
  it("uses singular German and English labels for one day", () => {
    expect(getStreakSuffix(1, "de")).toBe(" Tag");
    expect(getStreakSuffix(1, "en")).toBe(" day");
  });

  it("uses plural labels for zero and multiple days", () => {
    expect(getStreakSuffix(0, "de")).toBe(" Tage");
    expect(getStreakSuffix(2, "de")).toBe(" Tage");
    expect(getStreakSuffix(2, "en")).toBe(" days");
  });
});
