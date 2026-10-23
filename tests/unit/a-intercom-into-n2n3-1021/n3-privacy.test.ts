/** a-intercom-into-n2n3-1021, N3: the Telegram bridge sentence joins the one Intercom privacy row. */
import { describe, expect, it } from "vitest";
import { BRIDGE_PRIVACY } from "@/lib/intercom/bridge-privacy-copy";
import { INTERCOM_CONTACT_SYNC_ENTRY, INTERCOM_MESSENGER_ENTRY, INTERCOM_SYNC_NEWS_SENTENCE, intercomPrivacyEntry } from "@/lib/intercom/privacy-copy";

describe("bridge in the Intercom privacy row", () => {
  it("stands alone with the US line when nothing else is on", () => {
    const e = intercomPrivacyEntry({ messenger: false, sync: false, bridge: true })!;
    expect(e.purpose).toEqual(BRIDGE_PRIVACY.intercomPurpose);
    expect(e.jurisdiction).toEqual(BRIDGE_PRIVACY.intercomJurisdiction);
  });
  it("joins the messenger row and names the US workspace", () => {
    const e = intercomPrivacyEntry({ messenger: true, sync: false, bridge: true })!;
    expect(e.purpose.de).toBe(`${INTERCOM_MESSENGER_ENTRY.purpose.de} ${BRIDGE_PRIVACY.intercomPurpose.de}`);
    expect(e.jurisdiction).toEqual(BRIDGE_PRIVACY.intercomJurisdiction);
  });
  it("joins the contact sync row in the Lektor order and keeps its USA line", () => {
    const e = intercomPrivacyEntry({ messenger: true, sync: true, news: true, bridge: true })!;
    for (const lang of ["de", "en"] as const) {
      const t = e.purpose[lang];
      const chat = lang === "de" ? "Im Support-Chat kommen" : "In the support chat";
      const del = lang === "de" ? "Wenn Ihr Konto gelöscht wird" : "When your account is deleted";
      const i = [chat, BRIDGE_PRIVACY.intercomPurpose[lang], INTERCOM_SYNC_NEWS_SENTENCE[lang], del].map((x) => t.indexOf(x));
      expect(i.every((x) => x >= 0)).toBe(true);
      expect([...i].sort((a, b) => a - b)).toEqual(i);
    }
    expect(e.jurisdiction).toEqual(INTERCOM_CONTACT_SYNC_ENTRY.jurisdiction);
    const noNews = intercomPrivacyEntry({ messenger: true, sync: true, bridge: true })!;
    expect(noNews.purpose.de.indexOf(BRIDGE_PRIVACY.intercomPurpose.de)).toBeLessThan(noNews.purpose.de.indexOf("Wenn Ihr Konto gelöscht wird"));
  });
  it("without the bridge flag nothing changes", () => {
    expect(intercomPrivacyEntry({ messenger: true, sync: true, bridge: false })).toEqual(INTERCOM_CONTACT_SYNC_ENTRY);
  });
});

import { INTERCOM_TICKETS_SENTENCE } from "@/lib/intercom/privacy-copy";

describe("feedback tickets in the Intercom privacy row (Reviewer P2-2)", () => {
  it("sits after the Telegram block and before the consent sentence; deletion stays last", () => {
    const e = intercomPrivacyEntry({ messenger: true, sync: true, news: true, bridge: true, tickets: true })!;
    for (const lang of ["de", "en"] as const) {
      const t = e.purpose[lang];
      const del = lang === "de" ? "Wenn Ihr Konto gelöscht wird" : "When your account is deleted";
      const i = [BRIDGE_PRIVACY.intercomPurpose[lang], INTERCOM_TICKETS_SENTENCE[lang], INTERCOM_SYNC_NEWS_SENTENCE[lang], del].map((x) => t.indexOf(x));
      expect(i.every((x) => x >= 0)).toBe(true);
      expect([...i].sort((a, b) => a - b)).toEqual(i);
    }
  });
  it("is appended to the messenger row with the US line, and never shown without the flag", () => {
    const e = intercomPrivacyEntry({ messenger: true, sync: false, tickets: true })!;
    expect(e.purpose.de.endsWith(INTERCOM_TICKETS_SENTENCE.de)).toBe(true);
    expect(e.jurisdiction).toEqual(BRIDGE_PRIVACY.intercomJurisdiction);
    expect(intercomPrivacyEntry({ messenger: true, sync: false })!.purpose.de).not.toContain("Ticket");
    for (const t of [INTERCOM_TICKETS_SENTENCE.de, INTERCOM_TICKETS_SENTENCE.en]) expect(t).not.toMatch(/[–—]/);
  });
});
