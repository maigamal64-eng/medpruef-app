import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadMentorOperations } from "@/app/api/mentor/admin/operations/load";

const db = {
  from: () => {
    const q = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(), contains: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }), then: (r: (x: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r) };
    return q;
  },
  rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
} as unknown as SupabaseClient;

const ON = { AI_FEATURES_ENABLED: "true", MENTOR_ENABLED: "true", MENTOR_PACKAGES_ENABLED: "true" };
async function row(env: Record<string, string>) {
  const info = await loadMentorOperations(db, new Date("2026-10-14T12:00:00Z"), env);
  return info.checks.find((c) => c.key === "public_copy");
}

describe("readiness row: public mentor copy matches access (a-mentor-preconds)", () => {
  it("green while the copy is off", async () => { expect((await row({}))?.ok).toBe(true); });
  it("green with scope signed_in, packages and the mentor on", async () => {
    expect((await row({ ...ON, MENTOR_ACCESS_SCOPE: "signed_in", NEXT_PUBLIC_MENTOR_PUBLIC_COPY: "true" }))?.ok).toBe(true);
  });
  it("red under beta or paid, with packages off, or with the mentor off", async () => {
    for (const env of [
      { ...ON, NEXT_PUBLIC_MENTOR_PUBLIC_COPY: "true" },
      { ...ON, MENTOR_ACCESS_SCOPE: "paid", NEXT_PUBLIC_MENTOR_PUBLIC_COPY: "true" },
      { AI_FEATURES_ENABLED: "true", MENTOR_ENABLED: "true", MENTOR_ACCESS_SCOPE: "signed_in", NEXT_PUBLIC_MENTOR_PUBLIC_COPY: "true" },
      { MENTOR_PACKAGES_ENABLED: "true", MENTOR_ACCESS_SCOPE: "signed_in", NEXT_PUBLIC_MENTOR_PUBLIC_COPY: "true" },
    ]) expect((await row(env))?.ok, JSON.stringify(env)).toBe(false);
  });
  it("red when the included-credit copy is on", async () => {
    expect((await row({ ...ON, MENTOR_ACCESS_SCOPE: "signed_in", NEXT_PUBLIC_MENTOR_PUBLIC_COPY: "true", NEXT_PUBLIC_MENTOR_INCLUDED_COPY: "true" }))?.ok).toBe(false);
  });
});
