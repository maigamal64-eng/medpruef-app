import { describe, expect, it } from "vitest";
import { decideNotice, inHoldout, type NoticeInput } from "@/lib/trial-end-notice/rules";
import { renderNoticeMail, renderNoticeTelegram } from "@/lib/trial-end-notice/copy";
import { trialEndNoticeDryRun, trialEndNoticeEnabled, trialEndNoticeTelegramEnabled } from "@/lib/trial-end-notice/flag";

const now = new Date("2026-11-01T10:00:00Z");
const nonHoldoutId = (() => { for (let i = 0; i < 200; i++) { const id = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`; if (!inHoldout(id)) return id; } throw new Error("none"); })();
const holdoutId = (() => { for (let i = 0; i < 200; i++) { const id = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`; if (inHoldout(id)) return id; } throw new Error("none"); })();

function input(over: Partial<NoticeInput> = {}, acct: Partial<NoticeInput["account"]> = {}): NoticeInput {
  return {
    account: { id: nonHoldoutId, role: "user", tier: "pro", tierExpiresAt: "2026-11-02T04:00:00Z", email: "user-610e28c1@example.com", emailVerifiedAt: "2026-10-30T00:00:00Z", isBanned: false, telegramChatConfirmed: false, ...acct },
    trial: { startedAt: "2026-10-30T04:00:00Z", endsAt: "2026-11-02T04:00:00Z" },
    everPaid: false, checkoutSinceStart: false, mailInCap: false, decidedBefore: false, telegramEnabled: false, excluded: new Set(), now, ...over,
  };
}

describe("decideNotice", () => {
  it("sends one email to a confirmed trialist ending in under 24 h", () => {
    expect(decideNotice(input())).toEqual({ act: "send", channel: "email" });
  });
  it("holdout is stable and about one in five", () => {
    expect(inHoldout(holdoutId)).toBe(true);
    expect(decideNotice(input({}, { id: holdoutId }))).toEqual({ act: "hold", reason: "holdout" });
    let n = 0; for (let i = 0; i < 1000; i++) if (inHoldout(`u-${i}`)) n++;
    expect(n).toBeGreaterThan(130); expect(n).toBeLessThan(270);
  });
  it("skips decided, paid, checkout opener, staff, banned, excluded, out of window", () => {
    expect(decideNotice(input({ decidedBefore: true }))).toEqual({ act: "skip", reason: "already_decided" });
    expect(decideNotice(input({ everPaid: true }))).toEqual({ act: "skip", reason: "has_access" });
    expect(decideNotice(input({}, { tierExpiresAt: "2026-12-30T00:00:00Z" }))).toEqual({ act: "skip", reason: "has_access" });
    expect(decideNotice(input({ checkoutSinceStart: true }))).toEqual({ act: "skip", reason: "checkout_opened" });
    expect(decideNotice(input({}, { email: "user-847887c3@example.com" }))).toEqual({ act: "skip", reason: "staff" });
    expect(decideNotice(input({}, { isBanned: true }))).toEqual({ act: "skip", reason: "banned" });
    expect(decideNotice(input({ excluded: new Set([nonHoldoutId]) }))).toEqual({ act: "skip", reason: "excluded" });
    expect(decideNotice(input({ trial: { startedAt: "2026-10-30T04:00:00Z", endsAt: "2026-11-03T10:00:00Z" } }))).toEqual({ act: "skip", reason: "not_in_window" });
    expect(decideNotice(input({ trial: { startedAt: "2026-10-30T04:00:00Z", endsAt: "2026-11-01T10:20:00Z" } }))).toEqual({ act: "skip", reason: "not_in_window" });
    expect(decideNotice(input({ trial: null }))).toEqual({ act: "skip", reason: "no_trial" });
  });
  it("promotion pause in the learner's own sitting week", () => {
    expect(decideNotice(input({ sittingWeek: true }))).toEqual({ act: "hold", reason: "sitting_week" });
  });
  it("mail cap holds both channels", () => {
    expect(decideNotice(input({ mailInCap: true }))).toEqual({ act: "hold", reason: "mail_cap" });
  });
  it("telegram only without a confirmed address and behind its own flag", () => {
    const tg = { email: null, emailVerifiedAt: null, telegramChatConfirmed: true };
    expect(decideNotice(input({}, tg))).toEqual({ act: "hold", reason: "no_channel" });
    expect(decideNotice(input({ telegramEnabled: true }, tg))).toEqual({ act: "send", channel: "telegram" });
    expect(decideNotice(input({ telegramEnabled: true, mailInCap: true }, tg))).toEqual({ act: "hold", reason: "mail_cap" });
    expect(decideNotice(input({}, { emailVerifiedAt: null }))).toEqual({ act: "hold", reason: "no_channel" });
    // a confirmed address wins over Telegram
    expect(decideNotice(input({ telegramEnabled: true }, { telegramChatConfirmed: true }))).toEqual({ act: "send", channel: "email" });
  });
});

describe("flags", () => {
  it("default off, dry run on, literal values only", () => {
    expect(trialEndNoticeEnabled({})).toBe(false);
    expect(trialEndNoticeEnabled({ TRIAL_END_NOTICE_ENABLED: "1" })).toBe(false);
    expect(trialEndNoticeEnabled({ TRIAL_END_NOTICE_ENABLED: "true" })).toBe(true);
    expect(trialEndNoticeDryRun({})).toBe(true);
    expect(trialEndNoticeDryRun({ TRIAL_END_NOTICE_DRY_RUN: "0" })).toBe(true);
    expect(trialEndNoticeDryRun({ TRIAL_END_NOTICE_DRY_RUN: "false" })).toBe(false);
    expect(trialEndNoticeTelegramEnabled({})).toBe(false);
  });
});

describe("copy", () => {
  const base = { firstName: "Amira", answered: 37, appUrl: "https://medpruf.com/?utm_source=trial_end_notice", sittingUrl: null };
  for (const lang of ["de", "en"] as const) {
    it(`${lang}: no dash characters, no price, no date, Stopp line, one link`, () => {
      const m = renderNoticeMail({ ...base, lang });
      const all = `${m.subject}\n${m.htmlBody}`;
      expect(all).not.toMatch(/[–—]/);
      expect(all).not.toMatch(/€|EUR|\$|\d{1,2}\.\d{1,2}\.\d{2,4}|\b20\d\d-\d\d-\d\d/);
      expect(all).toContain("Stopp");
      expect(all).toContain("37");
      expect((m.htmlBody.match(/<a href="https:\/\/medpruf\.com/g) ?? []).length).toBe(1);
      expect(m.htmlBody).not.toContain("api/sitting-link");
    });
    it(`${lang}: sitting link only when given`, () => {
      const m = renderNoticeMail({ ...base, lang, sittingUrl: "https://medpruf.com/api/sitting-link?t=x" });
      expect(m.htmlBody).toContain("api/sitting-link");
      const t = renderNoticeTelegram({ ...base, lang, sittingUrl: "https://medpruf.com/api/sitting-link?t=x" });
      expect(t.buttons).toHaveLength(2);
      expect(renderNoticeTelegram({ ...base, lang }).buttons).toHaveLength(1);
    });
  }
  it("German uses Sie, not du", () => {
    const m = renderNoticeMail({ ...base, lang: "de" });
    expect(m.htmlBody).toMatch(/\bIhr\b|\bSie\b/);
    expect(m.htmlBody).not.toMatch(/\b(du|dein|deine|dir|dich)\b/i);
  });
  it("escapes the name and drops the count when unknown", () => {
    const m = renderNoticeMail({ ...base, lang: "en", firstName: "<b>x</b>", answered: 0 });
    expect(m.htmlBody).not.toContain("<b>x");
    expect(m.htmlBody).toContain("Your progress stays saved.");
  });
});

import { summarize } from "../../../scripts/trial-end-notice/count";
describe("scoreboard summarize", () => {
  it("counts sent, held and the holdout comparison", () => {
    const ev = [
      { user_id: "a", event_type: "trial_end_notice_sent", event_data: { channel: "email" }, created_at: "2026-11-01T10:00:00Z" },
      { user_id: "b", event_type: "trial_end_notice_sent", event_data: { channel: "telegram" }, created_at: "2026-11-01T10:00:00Z" },
      { user_id: "c", event_type: "trial_end_notice_held", event_data: { reason: "holdout" }, created_at: "2026-11-01T10:00:00Z" },
      { user_id: "d", event_type: "trial_end_notice_held", event_data: { reason: "mail_cap" }, created_at: "2026-11-01T10:00:00Z" },
    ];
    const grants = [
      { user_id: "a", created_at: "2026-11-02T10:00:00Z" },
      { user_id: "c", created_at: "2026-11-09T10:00:00Z" },
    ];
    expect(summarize(ev, grants, 14)).toEqual({ days: 14, sent: 2, sentEmail: 1, sentTelegram: 1, held: { holdout: 1, mail_cap: 1 }, holdout: 1, paidAfterSent: 1, paidAfterHoldout: 0 });
  });
});
