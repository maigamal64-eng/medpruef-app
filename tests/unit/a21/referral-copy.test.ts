/**
 * a21 TR-27 / UX-ACC-50: the one referral invite and every share path.
 *
 * The invite (referral-copy.ts) is written to the friend: free path first,
 * the trial with its terms, and the sender's reward disclosed in the first
 * person. Every share builder must carry exactly that message.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  referralDisclosure,
  referralEmptyLine,
  referralInviteMessage,
  referralRewardSentence,
  referralRowState,
  referralWindowDefinition,
} from "@/lib/referral-copy";
import { referralNativeSharePayload, referralShareUrls } from "@/lib/referrals";
import { billingAmount } from "@/lib/billing-copy";
import { TIERS } from "@/lib/content-truth";

const LINK = "https://medpruf.com/login?ref=ABCD2345";
const DASH = /[–—]/;
const LANGS = ["de", "en"] as const;

const DISCLOSURE = {
  de: "Offen gesagt: Ich erhalte Pro kostenlos, wenn Sie und eine weitere Person über meinen Link den Pro-Test starten und üben.",
  en: "To be open: I receive Pro for free if you and one other person start the Pro trial through my link and practise.",
} as const;
const FREE = { de: "kostenlos und ohne Karte", en: "for free, no card needed" } as const;
const TRIAL = { de: "Pro-Test", en: "Pro trial" } as const;

describe("referralInviteMessage", () => {
  for (const lang of LANGS) {
    const msg = referralInviteMessage(lang, LINK);

    it(`${lang}: contains the first-person disclosure sentence`, () => {
      expect(msg).toContain(DISCLOSURE[lang]);
    });

    it(`${lang}: contains no em or en dash`, () => {
      expect(msg).not.toMatch(DASH);
    });

    it(`${lang}: names the free path before the trial`, () => {
      const free = msg.indexOf(FREE[lang]);
      const trial = msg.indexOf(TRIAL[lang]);
      expect(free).toBeGreaterThan(-1);
      expect(trial).toBeGreaterThan(-1);
      expect(free).toBeLessThan(trial);
    });

    it(`${lang}: states the trial price from TIERS and 0 today`, () => {
      expect(msg).toContain(billingAmount(TIERS.first_month_19.price_cents, lang));
      expect(msg).toContain(billingAmount(0, lang));
    });

    it(`${lang}: ends with the link`, () => {
      expect(msg.endsWith(LINK)).toBe(true);
    });
  }

  it("de: formal Sie, no du forms", () => {
    const msg = referralInviteMessage("de", LINK);
    expect(msg).not.toMatch(/\b(du|dich|dir|dein|deine|deinen|deinem|deiner)\b/i);
  });
});

describe("share builders encode the invite message", () => {
  for (const lang of LANGS) {
    const msg = referralInviteMessage(lang, LINK);

    it(`${lang}: WhatsApp text is exactly the invite`, () => {
      const url = new URL(referralShareUrls(msg, LINK).whatsapp);
      expect(url.origin).toBe("https://wa.me");
      expect(url.searchParams.get("text")).toBe(msg);
    });

    it(`${lang}: Telegram text is exactly the invite and url is the link`, () => {
      const url = new URL(referralShareUrls(msg, LINK).telegram);
      expect(url.origin + url.pathname).toBe("https://t.me/share/url");
      expect(url.searchParams.get("text")).toBe(msg);
      expect(url.searchParams.get("url")).toBe(LINK);
    });

    it(`${lang}: native share text is exactly the invite`, () => {
      expect(referralNativeSharePayload(msg, "MedPrüf").text).toBe(msg);
    });
  }

  it("offers no share target that cannot carry the full invite", () => {
    expect(Object.keys(referralShareUrls("x", LINK)).sort()).toEqual(["telegram", "whatsapp"]);
  });
});

describe("surfaces read the single sources", () => {
  const root = join(__dirname, "..", "..", "..");
  const read = (rel: string) => readFileSync(join(root, rel), "utf8");
  const page = read("src/app/referrals/page.tsx");
  const card = read("src/components/ReferralCodeCard.tsx");
  const floater = read("src/components/ReferralShareFloater.tsx");
  const quiz = read("src/app/quiz/page.tsx");

  it("/referrals builds every share path from referralInviteMessage", () => {
    expect(page).toContain("referralInviteMessage(lang, data.referralLink)");
    expect(page).toContain("referralShareUrls(inviteMessage(), data.referralLink)");
    expect(page).toContain("referralNativeSharePayload(inviteMessage()");
    expect(page).not.toContain("billingReferralShare");
    expect(page).not.toMatch(/t\.me\/share|wa\.me|twitter\.com\/intent/);
  });

  it("bare-code and link-only surfaces show the disclosure", () => {
    expect(card).toContain("referralDisclosure(lang)");
    expect(page).toContain("referralDisclosure(lang)");
    expect(quiz).toContain("referralDisclosure(lang)");
  });

  it("no surface reads the old du referral strings", () => {
    for (const src of [page, card, floater, quiz]) {
      expect(src).not.toMatch(/billingSurfaceText\("(referrals_page_tsx_|quiz_page_tsx_[01]|surface_3[5-8])|t\("ref_floater_(title|body)"/);
      expect(src).not.toContain("Kolleg:innen");
    }
  });

  it("/referrals uses the one reward sentence, row states and empty line", () => {
    expect(page).toContain("referralRewardSentence(lang)");
    expect(page).toContain("referralWindowDefinition(lang)");
    expect(page).toContain('referralRowState("counts", lang)');
    expect(page).toContain("referralEmptyLine(lang)");
    expect(page).not.toMatch(/unser Team|our team/);
  });
});

describe("referral copy facts", () => {
  it("row states and empty line match the UX-ACC-50 wording", () => {
    expect(referralRowState("signed_up", "de")).toBe("Angemeldet");
    expect(referralRowState("learning_no_trial", "de")).toBe("Lernt, Pro-Test fehlt");
    expect(referralRowState("counts", "de")).toBe("Zählt");
    expect(referralEmptyLine("de")).toContain("Ihren Link");
  });

  it("reward sentence keeps its condition, personal confirmation and no dash", () => {
    for (const lang of LANGS) {
      for (const s of [referralRewardSentence(lang), referralWindowDefinition(lang), referralDisclosure(lang)]) {
        expect(s).not.toMatch(DASH);
      }
    }
    expect(referralRewardSentence("de")).toContain("Wir bestätigen das persönlich.");
    expect(referralRewardSentence("de")).toContain("Kolleginnen und Kollegen");
  });
});
