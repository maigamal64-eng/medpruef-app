import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// a-intercom-telegram-bridge: Telegram DMs to @MedPruefBot reach the Intercom
// inbox and admin replies come back through the customer bot. Flag
// TELEGRAM_INTERCOM_BRIDGE_ENABLED, default OFF.

type Row = { provider: string; event_id: string; payload: Record<string, unknown> };

const db: {
  users: Array<{ id: string; telegram_id: number | null; language_code?: string | null }>;
  events: Map<string, Row>;
  inbound: unknown[];
  usersLookupFails: boolean;
  eventsFail: boolean;
} = { users: [], events: new Map(), inbound: [], usersLookupFails: false, eventsFail: false };

const key = (p: string, e: string) => `${p}|${e}`;

function fakeClient() {
  return {
    from(table: string) {
      if (table === "users") {
        const filters: Record<string, unknown> = {};
        const chain = {
          select() { return chain; },
          eq(col: string, val: unknown) { filters[col] = val; return chain; },
          async maybeSingle() {
            if (db.usersLookupFails) return { data: null, error: { message: "timeout" } };
            const hit = db.users.find((u) => Object.entries(filters).every(([c, v]) => (u as Record<string, unknown>)[c] === v));
            return { data: hit ?? null, error: null };
          },
          update() { return { eq: async () => ({ error: null }) }; },
        };
        return chain;
      }
      if (table === "telegram_inbound" || table === "telegram_login_tokens") {
        return { insert: async (row: unknown) => { db.inbound.push(row); return { error: null }; } };
      }
      if (table === "processed_webhook_events") {
        const filters: Record<string, string> = {};
        const chain = {
          select() { return chain; },
          eq(col: string, val: string) { filters[col] = val; return chain; },
          async maybeSingle() {
            if (db.eventsFail) return { data: null, error: { message: "timeout" } };
            const row = db.events.get(key(filters.provider, filters.event_id));
            return { data: row ? { payload: row.payload } : null, error: null };
          },
          async insert(row: Row) {
            if (db.eventsFail) return { error: { message: "timeout" } };
            const k = key(row.provider, row.event_id);
            if (db.events.has(k)) return { error: { code: "23505", message: "duplicate" } };
            db.events.set(k, row);
            return { error: null };
          },
          async upsert(row: Row) {
            db.events.set(key(row.provider, row.event_id), row);
            return { error: null };
          },
        };
        return chain;
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

vi.mock("@/lib/supabase", () => ({ getServiceClient: vi.fn(() => fakeClient()) }));

import { POST as telegramPOST } from "@/app/api/telegram/webhook/route";
import { HEAD as intercomHEAD, POST as intercomPOST } from "@/app/api/intercom/webhook/route";
import { bridgeTelegramMessage, htmlToText, truncateText } from "@/lib/intercom/telegram-bridge";
import { verifyIntercomSignature } from "@/lib/intercom/webhook";

const TG_SECRET = "unit-tg-secret";
const CLIENT_SECRET = "unit-intercom-client-secret";
const LEARNER = "11111111-2222-4333-8444-555555555555";

type Call = { url: string; method: string; body: Record<string, unknown> | null; headers: Record<string, string> };
let calls: Call[] = [];
let intercomResponder: (call: Call) => { status: number; body: unknown } = () => ({ status: 200, body: {} });
let telegramStatus = 200;
let contactCreateDelayMs = 0;

function installFetch() {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const call: Call = {
        url,
        method: init?.method ?? "GET",
        body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
        headers: (init?.headers ?? {}) as Record<string, string>,
      };
      calls.push(call);
      if (url.startsWith("https://api.telegram.org/")) return new Response("{}", { status: telegramStatus });
      if (contactCreateDelayMs && call.method === "POST" && url.endsWith("/contacts")) await new Promise((r) => setTimeout(r, contactCreateDelayMs));
      const r = intercomResponder(call);
      return new Response(JSON.stringify(r.body), { status: r.status });
    }),
  );
}

/** A simple Intercom stand-in: contacts, tags and conversations. */
function intercomWorld() {
  let n = 0;
  const contactsByExternal = new Map<string, string>();
  return (call: Call) => {
    const path = call.url.replace("https://api.intercom.io", "");
    if (call.method === "GET" && path.startsWith("/contacts/find_by_external_id/")) {
      const ext = decodeURIComponent(path.split("/").pop()!);
      const id = contactsByExternal.get(ext);
      return id ? { status: 200, body: { type: "contact", id } } : { status: 404, body: { type: "error.list" } };
    }
    if (call.method === "POST" && path === "/contacts") {
      const id = `ct${++n}`;
      if (call.body?.external_id) contactsByExternal.set(String(call.body.external_id), id);
      return { status: 200, body: { type: "contact", id, role: call.body?.role } };
    }
    if (call.method === "POST" && path === "/tags") return { status: 200, body: { type: "tag", id: "tag1", name: call.body?.name } };
    if (call.method === "POST" && /^\/contacts\/[^/]+\/tags$/.test(path)) return { status: 200, body: { type: "tag" } };
    if (call.method === "POST" && path === "/conversations") return { status: 200, body: { type: "user_message", id: "m1", conversation_id: `cv${++n}` } };
    if (call.method === "POST" && /^\/conversations\/[^/]+\/reply$/.test(path)) return { status: 200, body: { type: "conversation" } };
    return { status: 500, body: {} };
  };
}

function tgUpdate(text: string, fromId = 4242, chatType = "private") {
  return new NextRequest("http://unit.test/api/telegram/webhook", {
    method: "POST",
    headers: { "x-telegram-bot-api-secret-token": TG_SECRET },
    body: JSON.stringify({ message: { chat: { id: fromId, type: chatType }, text, from: { id: fromId, first_name: "A" } } }),
  });
}

function sign(raw: string, secret = CLIENT_SECRET) {
  return `sha1=${createHmac("sha1", secret).update(raw).digest("hex")}`;
}

function intercomNotification(conversationId: string, parts: unknown[], topic = "conversation.admin.replied") {
  return JSON.stringify({
    type: "notification_event",
    topic,
    id: `notif_${Math.random().toString(36).slice(2)}`,
    data: { item: { type: "conversation", id: conversationId, conversation_parts: { conversation_parts: parts } } },
  });
}

function intercomReq(raw: string, signature: string | null = sign(raw)) {
  return new NextRequest("http://unit.test/api/intercom/webhook", {
    method: "POST",
    headers: signature ? { "x-hub-signature": signature, "content-type": "application/json" } : { "content-type": "application/json" },
    body: raw,
  });
}

const intercomCalls = () => calls.filter((c) => c.url.startsWith("https://api.intercom.io"));
const telegramCalls = () => calls.filter((c) => c.url.startsWith("https://api.telegram.org"));

function enableBridge() {
  vi.stubEnv("TELEGRAM_INTERCOM_BRIDGE_ENABLED", "true");
  vi.stubEnv("NEXT_PUBLIC_TELEGRAM_INTERCOM_BRIDGE", "true"); // build copy (a-intercom-into-n2n3-1021)
  vi.stubEnv("MEDPRUF_INTERCOM_ACCESS_TOKEN", "unit-medpruef-token");
  vi.stubEnv("MEDPRUF_INTERCOM_CLIENT_SECRET", CLIENT_SECRET);
}

let clock = 0;

beforeEach(() => {
  // Fresh in-memory rate-limit windows per test: move the clock 3 h on.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(Date.UTC(2026, 9, 17) + ++clock * 3 * 3_600_000));
  db.users = [];
  db.events = new Map();
  db.inbound = [];
  db.usersLookupFails = false;
  db.eventsFail = false;
  telegramStatus = 200;
  contactCreateDelayMs = 0;
  intercomResponder = intercomWorld();
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", TG_SECRET);
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "unit-bot-token");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://medpruf.com");
  vi.stubEnv("TELEGRAM_OPS_FORWARD_TOKEN", "");
  vi.stubEnv("INTERCOM_ACCESS_TOKEN", "old-blink-token");
  vi.stubEnv("BLINK_EU_INTERCOM_ACCESS_TOKEN", "old-blink-token");
  installFetch();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("flag off", () => {
  it("makes no Intercom call for a free-text DM and still logs it", async () => {
    vi.stubEnv("MEDPRUF_INTERCOM_ACCESS_TOKEN", "unit-medpruef-token");
    vi.stubEnv("MEDPRUF_INTERCOM_CLIENT_SECRET", CLIENT_SECRET);
    const res = await telegramPOST(tgUpdate("Hallo, ich habe eine Frage"));
    expect(res.status).toBe(200);
    expect(db.inbound).toHaveLength(1);
    expect(intercomCalls()).toEqual([]);
    expect(db.events.size).toBe(0);
  });

  it("the receiver is a 404 for HEAD and POST and never relays", async () => {
    expect((await intercomHEAD()).status).toBe(404);
    const raw = intercomNotification("cv9", [{ id: "p1", part_type: "comment", body: "<p>Hi</p>", author: { type: "admin", id: "a1" } }]);
    const res = await intercomPOST(intercomReq(raw));
    expect(res.status).toBe(404);
    expect(calls).toEqual([]);
  });
});

describe("/start stays untouched", () => {
  for (const text of ["/start", "/start web_login", "/start auth_" + LEARNER]) {
    it(`${text}: same outbound calls with the flag on and off, none to Intercom`, async () => {
      db.users = [{ id: LEARNER, telegram_id: 4242, language_code: "de" }];
      await telegramPOST(tgUpdate(text));
      const off = calls.map((c) => c.url);
      const offInbound = db.inbound.length;

      installFetch();
      db.inbound = [];
      enableBridge();
      await telegramPOST(tgUpdate(text));
      expect(calls.map((c) => c.url)).toEqual(off);
      expect(db.inbound.length).toBe(offInbound);
      expect(intercomCalls()).toEqual([]);
    });
  }
});

describe("inbound DM, flag on", () => {
  beforeEach(enableBridge);

  it("an unmatched chat becomes a lead tagged with a random chat token, then a conversation", async () => {
    await telegramPOST(tgUpdate("Wann ist die nächste SIP?"));
    const ic = intercomCalls();
    expect(ic.map((c) => `${c.method} ${c.url.replace("https://api.intercom.io", "")}`)).toEqual([
      "POST /contacts",
      "POST /tags",
      "POST /contacts/ct1/tags",
      "POST /conversations",
    ]);
    expect(ic[0].body).toEqual({ role: "lead" });
    const tag = String(db.events.get(key("tg_bridge", "chat:4242"))!.payload.tag);
    expect(tag).toMatch(/^[0-9a-f]{16}$/);
    expect(ic[1].body).toEqual({ name: `telegram:${tag}` });
    // Random, never derived from the chat id or any secret Intercom holds.
    expect(tag).not.toContain("4242");
    expect(ic[3].body).toEqual({ from: { type: "lead", id: "ct1" }, body: "Wann ist die nächste SIP?" });
    // Pinned version, MedPruef token only.
    for (const c of ic) {
      expect(c.headers["Intercom-Version"]).toBe("2.17");
      expect(c.headers.Authorization).toBe("Bearer [secret]");
    }
    // Mapping is ours, server side; no message text stored by the bridge.
    const chat = db.events.get(key("tg_bridge", "chat:4242"))!.payload;
    expect(chat).toMatchObject({ chat_id: 4242, contact_id: "ct1", contact_role: "lead", user_id: null, conversation_id: "cv2" });
    expect(db.events.get(key("tg_bridge", "conv:cv2"))!.payload).toMatchObject({ chat_id: 4242 });
    expect(JSON.stringify([...db.events.values()])).not.toContain("SIP");
  });

  it("a matched learner writes as their own contact (external_id = account id)", async () => {
    db.users = [{ id: LEARNER, telegram_id: 4242 }];
    await telegramPOST(tgUpdate("Frage zur Zahlung"));
    const ic = intercomCalls();
    expect(ic.map((c) => `${c.method} ${c.url.replace("https://api.intercom.io", "")}`)).toEqual([
      `GET /contacts/find_by_external_id/${LEARNER}`,
      "POST /contacts",
      "POST /conversations",
    ]);
    expect(ic[1].body).toEqual({ role: "user", external_id: LEARNER });
    expect(ic[2].body).toEqual({ from: { type: "user", id: "ct1" }, body: "Frage zur Zahlung" });
  });

  it("a second DM replies into the same conversation instead of opening a new one", async () => {
    await telegramPOST(tgUpdate("eins"));
    installFetch();
    await telegramPOST(tgUpdate("zwei"));
    const ic = intercomCalls();
    expect(ic).toHaveLength(1);
    expect(ic[0].url).toBe("https://api.intercom.io/conversations/cv2/reply");
    expect(ic[0].body).toEqual({ message_type: "comment", type: "user", intercom_user_id: "ct1", body: "zwei" });
  });

  it("opens a new conversation when the stored one is gone", async () => {
    await telegramPOST(tgUpdate("eins"));
    const world = intercomWorld();
    intercomResponder = (call) => (call.url.endsWith("/reply") ? { status: 404, body: {} } : world(call));
    installFetch();
    await telegramPOST(tgUpdate("zwei"));
    const ic = intercomCalls().map((c) => `${c.method} ${c.url.replace("https://api.intercom.io", "")}`);
    expect(ic).toEqual(["POST /conversations/cv2/reply", "POST /conversations"]);
    expect(db.events.get(key("tg_bridge", "chat:4242"))!.payload).toMatchObject({ contact_id: "ct1" });
  });

  it("does not relay bot commands (e.g. /frage while its flag is off)", async () => {
    vi.stubEnv("TELEGRAM_QUESTION_ENABLED", "");
    await telegramPOST(tgUpdate("/frage"));
    await telegramPOST(tgUpdate("/help"));
    expect(intercomCalls()).toEqual([]);
  });

  it("a contact Intercom refuses (merged or deleted) is resolved again on the next message", async () => {
    await telegramPOST(tgUpdate("eins"));
    const world = intercomWorld();
    // Stored conversation gone, stored lead refused: next DM must not keep the dead contact.
    intercomResponder = (call) =>
      call.url.endsWith("/reply") ? { status: 404, body: {} } : call.url.endsWith("/conversations") ? { status: 422, body: {} } : world(call);
    installFetch();
    await telegramPOST(tgUpdate("zwei"));
    expect(db.events.get(key("tg_bridge", "chat:4242"))!.payload).toMatchObject({ contact_id: null, conversation_id: null });
    intercomResponder = intercomWorld();
    installFetch();
    await telegramPOST(tgUpdate("drei"));
    const ic = intercomCalls().map((c) => `${c.method} ${c.url.replace("https://api.intercom.io", "")}`);
    expect(ic[0]).toBe("POST /contacts");
    expect(ic).toContain("POST /conversations");
    expect(db.events.get(key("tg_bridge", "chat:4242"))!.payload).toMatchObject({ contact_id: "ct1", conversation_id: "cv2" });
  });

  it("a burst on a new chat across two instances creates one contact; the second message waits", async () => {
    vi.useRealTimers();
    contactCreateDelayMs = 200;
    const started = Date.now();
    const first = bridgeTelegramMessage({ chatId: 777, text: "a", matchedUserId: null });
    vi.resetModules();
    const otherInstance = await import("@/lib/intercom/telegram-bridge");
    const second = otherInstance.bridgeTelegramMessage({ chatId: 777, text: "b", matchedUserId: null });
    const [r1, r2] = await Promise.all([first, second]);
    expect(r1).toEqual({ status: "sent", created: true });
    expect(r2).toEqual({ status: "sent", created: false });
    expect(intercomCalls().filter((c) => c.method === "POST" && c.url.endsWith("/contacts"))).toHaveLength(1);
    // The second instance saw the pending claim and waited at least one poll.
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
  });

  it("caps the body at 4,096 characters", async () => {
    await telegramPOST(tgUpdate("x".repeat(5000)));
    const conv = intercomCalls().find((c) => c.url.endsWith("/conversations"))!;
    expect(String(conv.body?.body)).toHaveLength(4096);
  });

  it("never bridges group chats, bot senders or an unreadable account lookup", async () => {
    await telegramPOST(tgUpdate("in a group", -100123, "group"));
    db.usersLookupFails = true;
    await telegramPOST(tgUpdate("lookup down"));
    expect(intercomCalls()).toEqual([]);
  });

  it("never sends the old BlinkOS token", async () => {
    await telegramPOST(tgUpdate("hi"));
    for (const c of intercomCalls()) expect(JSON.stringify(c.headers)).not.toContain("old-blink-token");
  });

  it("is off when the MedPruef token is missing, even with the flag on", async () => {
    vi.stubEnv("MEDPRUF_INTERCOM_ACCESS_TOKEN", "");
    await telegramPOST(tgUpdate("hi"));
    expect(intercomCalls()).toEqual([]);
  });
});

describe("admin replies, flag on", () => {
  beforeEach(async () => {
    enableBridge();
    await telegramPOST(tgUpdate("Hallo"));
    installFetch();
  });

  const reply = { id: "p1", part_type: "comment", body: "<p>Gern, <b>hier</b> ist der Link: <a href=\"https://medpruf.com/wien-route\">Wien-Route</a></p>", author: { type: "admin", id: "a1" } };

  it("relays an admin reply once to the chat, even when Intercom delivers it twice", async () => {
    const raw = intercomNotification("cv2", [reply]);
    expect((await intercomPOST(intercomReq(raw))).status).toBe(200);
    expect((await intercomPOST(intercomReq(raw))).status).toBe(200);
    const sent = telegramCalls();
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toMatchObject({ chat_id: 4242, text: "Gern, hier ist der Link: Wien-Route (https://medpruf.com/wien-route)" });
    expect(db.events.get(key("tg_bridge", "relay:p1"))!.payload).toMatchObject({ state: "sent" });
  });

  it("never relays notes, bot or user parts", async () => {
    const raw = intercomNotification("cv2", [
      { id: "n1", part_type: "note", body: "<p>internal</p>", author: { type: "admin", id: "a1" } },
      { id: "b1", part_type: "comment", body: "<p>Fin</p>", author: { type: "bot", id: "f1" } },
      { id: "u1", part_type: "comment", body: "<p>learner</p>", author: { type: "user", id: "ct1" } },
    ]);
    await intercomPOST(intercomReq(raw));
    expect(telegramCalls()).toEqual([]);
  });

  it("ignores conversations the bridge did not create", async () => {
    await intercomPOST(intercomReq(intercomNotification("cv-other", [reply])));
    expect(telegramCalls()).toEqual([]);
  });

  it("answers 503 when the mapping store is unreadable, so Intercom resends; nothing is noted", async () => {
    db.eventsFail = true;
    const res = await intercomPOST(intercomReq(intercomNotification("cv2", [reply])));
    expect(res.status).toBe(503);
    expect(calls).toEqual([]);
    db.eventsFail = false;
    expect((await intercomPOST(intercomReq(intercomNotification("cv2", [reply])))).status).toBe(200);
    expect(telegramCalls()).toHaveLength(1);
  });

  it("refuses a body over 1 MB", async () => {
    const raw = intercomNotification("cv2", [{ ...reply, body: "x".repeat(1_100_000) }]);
    expect((await intercomPOST(intercomReq(raw))).status).toBe(413);
    expect(telegramCalls()).toEqual([]);
  });

  it("an inline image is not relayed and the inbox is told", async () => {
    const raw = intercomNotification("cv2", [{ id: "p3", part_type: "comment", body: "<p>Siehe Bild</p><img src=\"https://x/y.png\">", author: { type: "admin", id: "a1" } }]);
    await intercomPOST(intercomReq(raw));
    expect(telegramCalls()[0].body).toMatchObject({ text: "Siehe Bild" });
    expect(intercomCalls().filter((c) => c.body?.message_type === "note")).toHaveLength(1);
  });

  it("refuses a forged or missing signature", async () => {
    const raw = intercomNotification("cv2", [reply]);
    expect((await intercomPOST(intercomReq(raw, sign(raw, "wrong-secret")))).status).toBe(401);
    expect((await intercomPOST(intercomReq(raw, null))).status).toBe(401);
    expect(telegramCalls()).toEqual([]);
  });

  it("answers ping and HEAD", async () => {
    expect((await intercomHEAD()).status).toBe(200);
    const raw = JSON.stringify({ type: "notification_event", topic: "ping", id: null, data: { item: { type: "ping" } } });
    expect((await intercomPOST(intercomReq(raw))).status).toBe(200);
    expect(telegramCalls()).toEqual([]);
  });

  it("an attachment-only reply is not relayed and the inbox gets a note", async () => {
    const raw = intercomNotification("cv2", [{ id: "p2", part_type: "comment", body: "", author: { type: "admin", id: "a1" }, attachments: [{ url: "x" }] }]);
    await intercomPOST(intercomReq(raw));
    expect(telegramCalls()).toEqual([]);
    const note = intercomCalls().find((c) => c.url.endsWith("/conversations/cv2/reply"))!;
    expect(note.body).toMatchObject({ message_type: "note", type: "admin", admin_id: "a1" });
  });

  it("a blocked bot is not retried and the inbox gets a note", async () => {
    telegramStatus = 403;
    const raw = intercomNotification("cv2", [reply]);
    await intercomPOST(intercomReq(raw));
    await intercomPOST(intercomReq(raw));
    expect(telegramCalls()).toHaveLength(1);
    expect(db.events.get(key("tg_bridge", "relay:p1"))!.payload).toMatchObject({ state: "failed", reason: "blocked" });
    expect(intercomCalls().filter((c) => c.body?.message_type === "note")).toHaveLength(1);
  });
});

describe("helpers", () => {
  it("verifies the sha1 signature in constant time and fails closed without a secret", () => {
    expect(verifyIntercomSignature("{}", sign("{}"), CLIENT_SECRET)).toBe(true);
    expect(verifyIntercomSignature("{}", sign("{ }"), CLIENT_SECRET)).toBe(false);
    expect(verifyIntercomSignature("{}", sign("{}"), "")).toBe(false);
    expect(verifyIntercomSignature("{}", null, CLIENT_SECRET)).toBe(false);
  });

  it("turns Intercom HTML into plain text", () => {
    expect(htmlToText("<p>Hallo&nbsp;Frau A.</p><p>Zeile 2<br>Zeile 3</p>")).toBe("Hallo Frau A.\n\nZeile 2\nZeile 3");
    expect(htmlToText("<ul><li>eins</li><li>zwei</li></ul>")).toBe("- eins\n- zwei");
    expect(htmlToText("a &lt;b&gt; &amp; &#252; &#x1F600;")).toBe("a <b> & ü 😀");
    expect(htmlToText('<a href="javascript:alert(1)">klick</a>')).toBe("klick");
    expect(htmlToText("<a href='https://medpruf.com/faq'>FAQ</a>")).toBe("FAQ (https://medpruf.com/faq)");
  });

  it("truncates without splitting a surrogate pair", () => {
    const s = "a".repeat(4095) + "😀";
    expect(truncateText(s)).toBe("a".repeat(4095));
  });
});

describe("privacy copy", () => {
  it("has DE and EN for every line and no dashes", async () => {
    const { BRIDGE_PRIVACY } = await import("@/lib/intercom/bridge-privacy-copy");
    for (const [name, pair] of Object.entries(BRIDGE_PRIVACY)) {
      expect(pair.de, name).toBeTruthy();
      expect(pair.en, name).toBeTruthy();
      expect(`${pair.de} ${pair.en}`, name).not.toMatch(/[–—]/);
    }
    expect(BRIDGE_PRIVACY.intercomPurpose.de).toContain("erhält Intercom nicht");
  });
});
