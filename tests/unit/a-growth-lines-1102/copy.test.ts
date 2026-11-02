import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { A1_ASK_LINE, A1_SITTING_LINE } from "@/lib/free-empty-sitting/copy";
import { A2_POINTER } from "@/lib/spt-next-track/copy";
import { A3_ANSWER_LINE, A3_LERNPLAN_LINE } from "@/lib/reminder-lines/copy";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * sha256 of every approved line, DE then EN, taken from
 * reports/growth-weekly/2026-11-02/approved/in-app-lines.json (file sha256
 * 315a2b1a8ae37e06d8afd6b396250d70d9e8eb72362c51dc33bf3cb998935143).
 * Change a string only with a new Lektor APPROVE.
 */
const APPROVED: Record<string, [string, string, () => [string, string]]> = {
  a1_sitting_body: ["fc5a7ed440d5b0a3bab2a6dae4609129a5657b21c3c6899aed28269e77d32413", "3a547d96484a4464ce5b103f30d0fc40c71c68e98cf33b7f1603cdb4fd69a8a2", () => [A1_SITTING_LINE.de.body, A1_SITTING_LINE.en.body]],
  a1_sitting_cta: ["c3ca239103f94d92d44fc4b90f41ca4bf56732dfb30807627afb26c27ca06d8c", "eb81ce9b9a1f952b48b14d0dbe9fdb9129ad0932e0daa887eb947f36fb3d0e42", () => [A1_SITTING_LINE.de.cta, A1_SITTING_LINE.en.cta]],
  a1_ask_body: ["b71b5124e8f44f68e1cdb7c936cf01d406786721354a408afe8745e4c53cdf6b", "88ac934666d1c1c2df75ea2f3b9e77881444ee3908c8d524966667a244663bcf", () => [A1_ASK_LINE.de.body, A1_ASK_LINE.en.body]],
  a1_ask_cta: ["a32c61212a3d24d4af8cd6962ffa176edb7a5f1fd45298e9bb291700c7bab413", "ea36617a7c5f98dee8dd30703f46666928babc21063ef3315ccdf96fc794f0b8", () => [A1_ASK_LINE.de.cta, A1_ASK_LINE.en.cta]],
  a2_title: ["295ccca75c61f3c767929293fd022c460a033266d033155b32b79a93d68dd47e", "58fedd8e5ac893ab9d0bb079de928f86e82691f9b4c434634937fc5e1a1491f6", () => [A2_POINTER.de.title, A2_POINTER.en.title]],
  a2_body: ["797e3ebd759dc63db0a8153b354ccdce5b724c395326a6ad5fa2de5b471dfca0", "193bd5876997e957fd48f6099b0089da4b78e71cfad9a3e56dd8e8295139bd47", () => [A2_POINTER.de.body, A2_POINTER.en.body]],
  a2_cta: ["9393a5a3b136d5b7edd17feb49c168b6c248eda615b2a7e7ec1b66407f52101a", "79776eade6683c9905c39d2c89976c34d8b8ce81a1fc28f372a1bf9d46940e7d", () => [A2_POINTER.de.cta, A2_POINTER.en.cta]],
  a2_sample: ["46fb6f3eacd31fe6cb895b5fc7834daf556d66a6d679986bab03af1301a2f47f", "c1c933b58da954baddd2a17706b4484cf12b5041d3e05e02e5efbc3d9ccef7f8", () => [A2_POINTER.de.sampleLine, A2_POINTER.en.sampleLine]],
  a3_answer_body: ["d5477eb20649cb41bacf43930e270b59470d192b14a02e8d1800b14d25784053", "8e732942ae05a76e6c35b705da6a1cca51fe6e214bff79ffd46a46c439542ab1", () => [A3_ANSWER_LINE.de.body, A3_ANSWER_LINE.en.body]],
  a3_answer_cta: ["eecc241efae52af20883c8a9707628aa6de0bed0b5118e27620ac5ec691690ad", "86033f75a4c0876adfabca55e558f0ae8f9fa098506123fae47b7601411cc3e2", () => [A3_ANSWER_LINE.de.cta, A3_ANSWER_LINE.en.cta]],
  a3_answer_cta_in: ["a1e01b7200c85198b1ec272e20d76c2d8bf0a006b75c32908d8e40ab7ac4e8e3", "3400d77655424024f85470fd3cd4f4061d433553f8e8562697ed2a2d470c5f32", () => [A3_ANSWER_LINE.de.ctaSignedIn, A3_ANSWER_LINE.en.ctaSignedIn]],
  a3_lernplan: ["19d12128160346a5f64a00ffa64f998170ccd0b87adfece4dc767ab8e8d258a4", "619e52f7dd2e17fb516c722b87c4a7d702c25d110a34cc8af8593d2dc48b8e2d", () => [A3_LERNPLAN_LINE.de, A3_LERNPLAN_LINE.en]],
};

describe("growth lines copy (2 Nov)", () => {
  it("every string is byte-exact to the approved file", () => {
    for (const [key, [de, en, read]] of Object.entries(APPROVED)) {
      const [gotDe, gotEn] = read();
      expect(sha(gotDe), `de ${key}`).toBe(de);
      expect(sha(gotEn), `en ${key}`).toBe(en);
    }
  });

  it("no dashes, exclamation marks, digits or AI words", () => {
    for (const [, , read] of Object.values(APPROVED)) {
      for (const text of read()) expect(text).not.toMatch(/[\u2013\u2014!\d]|\b(AI|KI|bot)\b/);
    }
  });
});
