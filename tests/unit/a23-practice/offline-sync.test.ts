import { describe, expect, it } from "vitest";
import { emptySyncResult, MAX_REPLAY_ATTEMPTS, replayDecision } from "@/lib/offlineSync";
import { syncResultLines } from "@/components/question/OfflineSyncNotice";

describe("offline answer replay (UX-PRA-45)", () => {
  it("maps every status to one decision; a 409 is never retried", () => {
    expect(replayDecision(200)).toBe("saved");
    expect(replayDecision(401)).toBe("keep_auth");
    expect(replayDecision(403)).toBe("keep_auth");
    expect(replayDecision(402)).toBe("drop_plan");
    expect(replayDecision(404)).toBe("drop_unavailable");
    expect(replayDecision(409, { error: "Question is no longer available" })).toBe("drop_unavailable");
    expect(replayDecision(409, { error: "Request already used for another answer" })).toBe("drop_conflict");
    expect(replayDecision(400)).toBe("drop_unavailable");
    expect(replayDecision(500)).toBe("retry");
    expect(replayDecision(503)).toBe("retry");
    expect(replayDecision(429)).toBe("retry");
    expect(replayDecision(408)).toBe("retry");
    expect(MAX_REPLAY_ATTEMPTS).toBe(5);
  });
  it("says what was counted and what was dropped, never a blanket success", () => {
    const r = { ...emptySyncResult(), sent: 18, unavailable: 1, plan: 1 };
    expect(syncResultLines(r, "de")).toEqual([
      "Offline-Antworten übertragen: 18 gezählt. 2 nicht mehr gültig (Frage entfernt oder geändert, Kontingent erreicht oder nach 7 Tagen ohne Erfolg verworfen).",
    ]);
    expect(syncResultLines({ ...emptySyncResult(), waitingForLogin: 5 }, "en")).toEqual(["Please sign in again to send 5 answers."]);
    expect(syncResultLines(emptySyncResult(), "de")).toEqual([]);
  });
});
