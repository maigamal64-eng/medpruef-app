import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ACTIVATION_COPY, at, continueBody, translatedLine } from "@/lib/activation/copy";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** Lektor gate 15 Oct 2026 (a-activation-48h): sha256 of every line, DE then EN. */
const LEKTOR: Record<string, [string, string]> = {
  continue_title: ["89db881691d12e17e530197b7f342a16e0278e930dde68bea4f9f9945827dcee", "8f6545c62fc6033244eafc17306e0d698db70bcbf714f4f8e05703be5ead542c"],
  continue_body: ["389962650d00e8aafd2bde952b2833b02a169e2fc1fd73c24bea7a92fdc1a419", "cb4fd31cd79a095f2132fd24a141a199e640d2b885310b7f25d21f600dd6f658"],
  continue_body_one: ["c6266eb7623d62b40616903b42ce2a391c0f8d994855ad25e71577b986b4a6dd", "e93bd12daa7963638ab60ced8cd0875ae7dfe211c227ce9661b4cfceb3d2bdc8"],
  continue_button: ["54ffd16bbba6aeeca4d4d11cfbbb2b0e3ff890366809617d48fa52b8451b5ef0", "01381a0e7856134a8edfadc5eb307785cf401fbd167386180a763b609e074d36"],
  translated_line: ["2cfd0f3af0c1b4457039dd47d2a6f5a37e3b69c57a7cef18e50bd82c27743e9b", "4530f3d4afbed6a06ae7af6295531e461f03c6976e2eb60a3d882d33b556cc79"],
  translated_line_one: ["949b32edfe5bfc1b8179c5b48737f990edb2d8ce2aafe7f2f531769af99b294e", "f60d6609faee5950efe76ef65b2d2620cffe3d3385352d8e1ace2931c2d14734"],
  win_title: ["80f36bfab8b03ca8bb67b6ee2ee56afd399f1a4cf06b52043d4ffecc7c354443", "361baf3dffd375d64343ad69e9e63ef1e4c6cb46847180579b07a1e4d982a19a"],
  win_plan_named: ["daea32e9346603769e982cfc48d3ebf6fd00427beeb8446a3887e89ee091e963", "d4a2578049ec6cebcf2fb581a2ebc8aa0adcdd461eccfbf2a59a7d0218fe2b5e"],
  win_plan_button: ["94d47b7c161e7c09478a05cc0fb14a17204d94a901ee5ea15b60554463717967", "ee763d3a0beb87f5a321ca3b6737ed02549a05bb608beb2d5e6a049655942e94"],
  win_ask: ["1482f58c00c1a01afc6a9642a0b65e2b4a51cbfc027442b4013fce62967cb03f", "0d7ac9316ff7e1429a5acab69f25363b2552a3a35149f5fa0d34a64e0ff6fe9d"],
  win_ask_button: ["a0439041ae98a3a436f4bc16c86ed940f712422cbc662034836c27bcea5041e1", "2c7b5ec0d46f55e33774035519396c60c0653756abdac1f55d7039d81318fade"],
  reminder_title: ["f602b1e15802dec51bcc1d9edae6b970c8ae124f51c72c58c90e18a7a0bef756", "98dc0f510ebde1e2097e82690a56214f4da0a9b37eff575f503f97e3f110c887"],
  reminder_body_email: ["25ec7c3de4ade5abaab25078a0a4f700f4c3420e642f3eee6a25169dfd190aee", "584ea6b610841cc0587d295834fc0a0be09b3b79293d7859d236d687d5649fd1"],
  reminder_body_telegram: ["c8efbfa1930d16046adc66b591bc7d6856daa3d72e65268831f046cfaa01181d", "1aad85a97d72ef64a741ad4e1b71b83e372c1e7b9818b66f318ebd5cfe44d64b"],
  reminder_button: ["af396eac8e02e824e05c81450bfa4ad2ab6ad9bc0c31c3307bb39d02fb8e90f1", "ff20be3a0d27d170bd86539f0fa3ba8318e86afde483a98973c8a32e549bda90"],
  reminder_saving: ["fd18cde89026f3419f87eeb555d0f84d776e12a4f9c40c250ce012ae3a3b694d", "096b73624b092bdc6c7377ec5e6e989e2ce826b9f294de8368fb8f3ec1341f30"],
  reminder_saved: ["a63afd77a36402862893d059824226595dbab4bb68708b064d68a225ed02e106", "c92becea783781053185eaa2bb74ef695edc5aa9d4e8a935945523edc28b4660"],
  reminder_pending: ["4bd89be4d2ebed19567debaef79c6b11d5b63ed6e45477eaacc975fc93fef13a", "3dc854fe5381af2b5d5c4407bfa5bec5cf1e5642996e7a562e512270837c8386"],
  reminder_failed: ["d68fcbe62640f37666d556d227de1382d121adebaa2c770af87f3cc5375cd3fe", "353db788ed0654c7b40c5838366ffbbe8bb701ca073eb5f39845a5676c6de307"],
  later: ["c47401bce409a92aad77abc14b45c11166484bf14b0c0b24c12653f7aa3244c4", "73b6e48a1b552d112502d37a7b7870436efc5ea1de0bca58ccf12d6ae15d3a0c"],
  region: ["4cf2e83c1a276994c0f5623365eaeaa2be1da1b90664fc92076dd370ab2f7abe", "41865f1056fc5258b63a51dfa69b32795b4f46468a5302a72f59ec0ea3fb5ff6"],
  trial_value: ["34053e0c28fc61bcfc26a9f0f212f235c77dd248423dde55edd6fa5b5b4aced9", "839bc669300bda362ed566dba84025c3f3c2fb8f537bca6963fd2056fb112184"],
  trial_mock: ["7d7610ac86d21a9b14c58797c363cddfa4470ba69e15aaab724b2534b605548a", "7fdfc6d6fad8a765eee1c0684c356d1f25232914aa20d5879dacb1100e157f6d"],
  trial_mistakes: ["4ecd2228168c7de4d6c3f2fc4ead0ac4cbfd046bbf959cb3e18cf569752b9410", "5ce8b9840b94e405e44557e92a388866f7c0b4ce4d350b3906a7d037c51e45b4"],
  onb_date_why: ["31d3a09ba1f7be3b2cef2adb113968e313899e4551047805e407140d74d61746", "2999d06fc2638b92c50253a47b34e320ea67701fcaaf610eb820546c5d3d6a94"],
};

describe("activation copy", () => {
  it("every line is the Lektor-approved text", () => {
    expect(Object.keys(ACTIVATION_COPY).sort()).toEqual(Object.keys(LEKTOR).sort());
    for (const [key, [de, en]] of Object.entries(LEKTOR)) {
      const pair = ACTIVATION_COPY[key as keyof typeof ACTIVATION_COPY];
      expect(sha(pair.de), `de ${key}`).toBe(de);
      expect(sha(pair.en), `en ${key}`).toBe(en);
    }
  });

  it("keeps the voice rules: no dashes, no exclamation, no price, no du, no bare free", () => {
    for (const [key, pair] of Object.entries(ACTIVATION_COPY)) {
      for (const text of [pair.de, pair.en]) {
        expect(text, key).not.toMatch(/[–—!€]|\bEUR\b|\bunlimited\b|\bunbegrenzt\b/i);
      }
      expect(pair.de, key).not.toMatch(/\b(du|dich|dir|dein|deine)\b/i);
      expect(pair.en, key).not.toMatch(/\bfree\b(?! sample)/i);
    }
  });

  it("falls back to English for unreviewed languages and fills the placeholders", () => {
    expect(at("later", "ru")).toBe("Later");
    expect(at("later", "de")).toBe("Später");
    expect(continueBody(1, "de")).toBe("Noch eine Frage bis zu Ihren ersten 10.");
    expect(continueBody(4, "en")).toBe("4 more questions to reach your first 10. Your progress stays saved.");
    expect(translatedLine(0, "en", "de")).toBeNull();
    expect(translatedLine(3, null, "de")).toBeNull();
    expect(translatedLine(1, "en", "de")).toMatch(/^Bei einer dieser Fragen gibt es die Erklärung schon auf Englisch,/);
    expect(translatedLine(3, "ru", "en")).toMatch(/^For 3 of these questions the explanation is already available in Russian,/);
  });
});
