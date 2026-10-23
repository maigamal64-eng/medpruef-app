import { randomBytes } from "node:crypto";
import { getServiceClient } from "@/lib/supabase";
import { checkRateLimit } from "@/lib/rate-limit";
import { sendCustomerBotMessage } from "@/lib/telegram";
import { intercomRequest, intercomToken } from "@/lib/intercom/rest";

/**
 * Telegram to Intercom bridge (a-intercom-telegram-bridge, G8 of the 17 Oct
 * Intercom review). Flag TELEGRAM_INTERCOM_BRIDGE_ENABLED, default OFF.
 *
 * Inbound: a free-text DM to @MedPruefBot (after the telegram_inbound log,
 * private chats only, never /start or /frage) becomes a message in Intercom
 * from the learner's contact (external_id = account id) or, for a chat that
 * matches no account, from a lead tagged telegram:<random chat token>. Text only,
 * at most 4,096 characters; photos and files are not relayed.
 *
 * Outbound: conversation.admin.replied for a conversation this bridge
 * created is sent back to the chat through the customer bot
 * (sendCustomerBotMessage). Notes and bot or Fin parts are never relayed.
 * Each conversation part is relayed at most once (claim before send).
 *
 * The chat mapping lives only in our database (processed_webhook_events,
 * provider tg_bridge, RLS deny-all, service role only): rows chat:<chat id>
 * and conv:<conversation id>. Intercom never receives the chat id, name or
 * username, only a random per-chat token in the lead's tag (the job asked for
 * a chat id hash; a random token is the stronger reading). No message text is
 * stored by the bridge. Free text starting with "/" (bot commands) is not
 * relayed.
 */

export const BRIDGE_PROVIDER = "tg_bridge";
export const BRIDGE_MAX_CHARS = 4096;
/** Per chat, per instance: 20 bridged messages per 10 minutes. */
export const BRIDGE_CHAT_LIMIT = { limit: 20, windowMs: 10 * 60_000 };
/** Per instance: at most 30 new leads per hour (an unknown chat cannot mint unlimited contacts). */
export const BRIDGE_LEAD_LIMIT = { limit: 30, windowMs: 60 * 60_000 };

export function isTelegramIntercomBridgeEnabled(): boolean {
  return (
    process.env.TELEGRAM_INTERCOM_BRIDGE_ENABLED === "true" &&
    // Build copy (next.config.ts): never relay from a build whose privacy page omits the bridge.
    process.env.NEXT_PUBLIC_TELEGRAM_INTERCOM_BRIDGE === "true" &&
    intercomToken() !== null &&
    Boolean(process.env.MEDPRUF_INTERCOM_CLIENT_SECRET) &&
    Boolean(process.env.TELEGRAM_BOT_TOKEN)
  );
}

/** Cut at a code point boundary, never inside a surrogate pair. */
export function truncateText(text: string, max = BRIDGE_MAX_CHARS): string {
  if (text.length <= max) return text;
  let cut = max;
  const code = text.charCodeAt(cut - 1);
  if (code >= 0xd800 && code <= 0xdbff) cut -= 1;
  return text.slice(0, cut);
}

/**
 * Pseudonymous label for a chat's Intercom tag: 16 random hex characters kept
 * in our chat row. Random rather than derived, so nobody holding an Intercom
 * secret can map it back to the Telegram id (which fits in about 10 digits).
 */
export function newChatTag(): string {
  return randomBytes(8).toString("hex");
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

/** Intercom part bodies are HTML; Telegram gets plain text. */
export function htmlToText(html: string): string {
  let s = html.replace(/\r\n?/g, "\n");
  s = s.replace(/<a\s[^>]*href\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi, (_m, dq: string | undefined, sq: string | undefined, label: string) => {
    const href = dq ?? sq ?? "";
    const text = label.replace(/<[^>]*>/g, "").trim();
    const url = href.trim();
    if (!/^(https?:|mailto:)/i.test(url) || text === url || !text) return text || url;
    return `${text} (${url})`;
  });
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<li[^>]*>/gi, "\n- ");
  s = s.replace(/<\/(p|div|h[1-6]|ul|ol|blockquote|pre)>/gi, "\n\n");
  s = s.replace(/<[^>]*>/g, "");
  s = s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (m, ent: string) => {
    const lower = ent.toLowerCase();
    if (lower in ENTITIES) return ENTITIES[lower];
    const cp = lower.startsWith("#x") ? parseInt(lower.slice(2), 16) : lower.startsWith("#") ? parseInt(lower.slice(1), 10) : NaN;
    if (Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff) {
      try {
        return String.fromCodePoint(cp);
      } catch {
        return m;
      }
    }
    return m;
  });
  return s
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------------------------------------------------------------------------
// Mapping store (processed_webhook_events as a server-side key/value table)

export interface ChatRow {
  v: 1;
  chat_id: number;
  /** Random token for the lead tag (never derived from the chat id). */
  tag: string;
  /** null until resolved, or after Intercom refused the stored contact. */
  contact_id: string | null;
  contact_role: "user" | "lead" | null;
  user_id: string | null;
  conversation_id: string | null;
  /** Set while the first message of a chat is creating its contact (burst guard). */
  pending_at?: string | null;
}

async function readRow<T>(eventId: string): Promise<{ ok: true; row: T | null } | { ok: false }> {
  const { data, error } = await getServiceClient()
    .from("processed_webhook_events")
    .select("payload")
    .eq("provider", BRIDGE_PROVIDER)
    .eq("event_id", eventId)
    .maybeSingle();
  if (error) return { ok: false };
  return { ok: true, row: (data?.payload as T | undefined) ?? null };
}

async function writeRow(eventId: string, payload: object): Promise<boolean> {
  const { error } = await getServiceClient()
    .from("processed_webhook_events")
    .upsert({ provider: BRIDGE_PROVIDER, event_id: eventId, payload }, { onConflict: "provider,event_id" });
  return !error;
}

/** Insert-only claim. true = this caller owns it, false = already claimed, null = unreadable. */
async function claim(eventId: string, payload: object): Promise<boolean | null> {
  const { error } = await getServiceClient()
    .from("processed_webhook_events")
    .insert({ provider: BRIDGE_PROVIDER, event_id: eventId, payload });
  if (!error) return true;
  if ((error as { code?: string }).code === "23505") return false;
  return null;
}

// ---------------------------------------------------------------------------
// Inbound

export type BridgeInboundResult =
  | { status: "off" | "rate_limited" | "store_unavailable" | "contact_failed" | "conversation_failed" | "empty" | "command" }
  | { status: "sent"; created: boolean };

interface ContactRef {
  id: string;
  role: "user" | "lead";
}

/** Intercom statuses that mean the stored contact or conversation can no longer be used. */
const REFUSED = new Set([400, 403, 404, 410, 422]);
/** A first-message claim older than this is taken over. */
const PENDING_STALE_MS = 60_000;
const PENDING_WAIT_MS = 1_000;
const PENDING_WAIT_TRIES = 3;

function readId(data: unknown, key = "id"): string | null {
  const v = data && typeof data === "object" ? (data as Record<string, unknown>)[key] : null;
  return typeof v === "string" && v ? v : typeof v === "number" ? String(v) : null;
}

/** An existing contact id named by a 409 "already exists" error, if any. */
function conflictContactId(data: unknown): string | null {
  const text = JSON.stringify(data ?? "");
  const m = text.match(/id=([a-f0-9]{8,})/i);
  return m ? m[1] : null;
}

async function resolveUserContact(userId: string): Promise<ContactRef | null> {
  const found = await intercomRequest("GET", `/contacts/find_by_external_id/${encodeURIComponent(userId)}`);
  const foundId = found.ok ? readId(found.data) : null;
  if (foundId) return { id: foundId, role: "user" };
  if (found.status !== 404 && found.status !== 410) {
    console.warn("[tg-intercom-bridge] contact lookup failed", found.status);
    return null;
  }
  const created = await intercomRequest("POST", "/contacts", { role: "user", external_id: userId });
  const createdId = created.ok ? readId(created.data) : null;
  if (createdId) return { id: createdId, role: "user" };
  if (created.status === 409) {
    const existing = conflictContactId(created.data);
    if (existing) return { id: existing, role: "user" };
  }
  console.warn("[tg-intercom-bridge] contact create failed", created.status);
  return null;
}

async function createLead(tag: string): Promise<ContactRef | null> {
  if (!checkRateLimit({ key: "tg-bridge:leads", ...BRIDGE_LEAD_LIMIT }).allowed) return null;
  const created = await intercomRequest("POST", "/contacts", { role: "lead" });
  const id = created.ok ? readId(created.data) : null;
  if (!id) {
    console.warn("[tg-intercom-bridge] lead create failed", created.status);
    return null;
  }
  // The tag is a label for the inbox; the mapping that routes replies is ours.
  const tagged = await intercomRequest("POST", "/tags", { name: `telegram:${tag}` });
  const tagId = tagged.ok ? readId(tagged.data) : null;
  if (tagId) {
    const attached = await intercomRequest("POST", `/contacts/${encodeURIComponent(id)}/tags`, { id: tagId });
    if (!attached.ok) console.warn("[tg-intercom-bridge] lead tag not attached", attached.status);
  } else {
    console.warn("[tg-intercom-bridge] lead tag not created", tagged.status);
  }
  return { id, role: "lead" };
}

type Attempt = { ok: true; id: string } | { ok: false; refused: boolean; status: number };

async function createConversation(contact: ContactRef, body: string): Promise<Attempt> {
  const res = await intercomRequest("POST", "/conversations", { from: { type: contact.role, id: contact.id }, body });
  const id = res.ok ? readId(res.data, "conversation_id") : null;
  if (id) return { ok: true, id };
  return { ok: false, refused: REFUSED.has(res.status), status: res.status };
}

async function replyAsContact(conversationId: string, contactId: string, body: string): Promise<Attempt> {
  const res = await intercomRequest("POST", `/conversations/${encodeURIComponent(conversationId)}/reply`, {
    message_type: "comment",
    type: "user",
    intercom_user_id: contactId,
    body,
  });
  if (res.ok) return { ok: true, id: conversationId };
  return { ok: false, refused: REFUSED.has(res.status), status: res.status };
}

/** Messages of one chat are bridged in order on an instance. */
const chatQueues = new Map<number, Promise<unknown>>();

export interface InboundMessage {
  chatId: number;
  text: string;
  /** users.id whose telegram_id equals the sender, null when none. */
  matchedUserId: string | null;
}

export function bridgeTelegramMessage(msg: InboundMessage): Promise<BridgeInboundResult> {
  const prev = chatQueues.get(msg.chatId) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(() => bridgeOne(msg));
  const tail = run.catch(() => undefined);
  chatQueues.set(msg.chatId, tail);
  void tail.then(() => {
    if (chatQueues.get(msg.chatId) === tail) chatQueues.delete(msg.chatId);
  });
  return run;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isFreshPending(row: ChatRow | null, now = Date.now()): boolean {
  if (!row?.pending_at || row.contact_id) return false;
  const at = Date.parse(row.pending_at);
  return Number.isFinite(at) && now - at < PENDING_STALE_MS;
}

/**
 * Read the chat row. The first message of a new chat claims it (insert-only),
 * so a burst on several instances creates one contact; a later message waits
 * briefly for the first one to finish.
 */
async function loadChatRow(chatId: number, matchedUserId: string | null): Promise<{ ok: true; row: ChatRow } | { ok: false }> {
  const key = `chat:${chatId}`;
  const read = await readRow<ChatRow>(key);
  if (!read.ok) return { ok: false };
  let row = read.row && read.row.v === 1 ? read.row : null;
  if (!row) {
    const fresh: ChatRow = {
      v: 1, chat_id: chatId, tag: newChatTag(), contact_id: null, contact_role: null,
      user_id: matchedUserId, conversation_id: null, pending_at: new Date().toISOString(),
    };
    const owned = await claim(key, fresh);
    if (owned === null) return { ok: false };
    if (owned) return { ok: true, row: { ...fresh, pending_at: null } };
    const again = await readRow<ChatRow>(key);
    if (!again.ok || !again.row) return { ok: false };
    row = again.row;
  }
  for (let i = 0; i < PENDING_WAIT_TRIES && isFreshPending(row); i++) {
    await sleep(PENDING_WAIT_MS);
    const again = await readRow<ChatRow>(key);
    if (!again.ok || !again.row) return { ok: false };
    row = again.row;
  }
  if (!row.tag) row = { ...row, tag: newChatTag() };
  return { ok: true, row };
}

async function bridgeOne({ chatId, text, matchedUserId }: InboundMessage): Promise<BridgeInboundResult> {
  if (!isTelegramIntercomBridgeEnabled()) return { status: "off" };
  const trimmed = text.trim();
  if (!trimmed) return { status: "empty" };
  // Bot commands (/frage with its flag off, /help, a mistyped /start) are not support messages.
  if (trimmed.startsWith("/")) return { status: "command" };
  const body = truncateText(trimmed);
  if (!checkRateLimit({ key: `tg-bridge:chat:${chatId}`, ...BRIDGE_CHAT_LIMIT }).allowed) return { status: "rate_limited" };

  const loaded = await loadChatRow(chatId, matchedUserId);
  if (!loaded.ok) return { status: "store_unavailable" };
  const row = loaded.row;
  const key = `chat:${chatId}`;
  const save = (patch: Partial<ChatRow>) => writeRow(key, { ...row, ...patch, pending_at: null } satisfies ChatRow);

  let contact: ContactRef | null = null;
  let conversationId: string | null = null;
  if (row.contact_id && row.contact_role && row.user_id === matchedUserId) {
    contact = { id: row.contact_id, role: row.contact_role };
    conversationId = row.conversation_id;
  } else {
    contact = matchedUserId ? await resolveUserContact(matchedUserId) : await createLead(row.tag);
  }
  if (!contact) {
    await save({ contact_id: null, contact_role: null, user_id: matchedUserId, conversation_id: null });
    return { status: "contact_failed" };
  }
  if (contact.id !== row.contact_id) {
    // Saved before the conversation call, so a parallel first message finds the contact (burst guard).
    await save({ contact_id: contact.id, contact_role: contact.role, user_id: matchedUserId, conversation_id: null });
  }

  let created = false;
  if (conversationId) {
    const replied = await replyAsContact(conversationId, contact.id, body);
    if (!replied.ok) {
      console.warn("[tg-intercom-bridge] reply into stored conversation failed", replied.status);
      if (!replied.refused) return { status: "conversation_failed" };
      conversationId = null;
    }
  }
  if (!conversationId) {
    const opened = await createConversation(contact, body);
    if (!opened.ok) {
      console.warn("[tg-intercom-bridge] conversation create failed", opened.status);
      // A refused contact (merged, archived, deleted) is resolved again on the next message;
      // otherwise keep it so a retry never mints a second lead for this chat.
      await save(
        opened.refused
          ? { contact_id: null, contact_role: null, user_id: matchedUserId, conversation_id: null }
          : { contact_id: contact.id, contact_role: contact.role, user_id: matchedUserId, conversation_id: null },
      );
      return { status: "conversation_failed" };
    }
    conversationId = opened.id;
    created = true;
  }

  const savedChat = await save({ contact_id: contact.id, contact_role: contact.role, user_id: matchedUserId, conversation_id: conversationId });
  const savedConv = created ? await writeRow(`conv:${conversationId}`, { v: 1, chat_id: chatId }) : true;
  if (!savedChat || !savedConv) console.error("[tg-intercom-bridge] mapping write failed");
  return { status: "sent", created };
}

// ---------------------------------------------------------------------------
// Outbound (conversation.admin.replied)

export interface IntercomNotification {
  type?: string;
  topic?: string;
  id?: string | null;
  data?: { item?: unknown };
}

interface ConversationPart {
  id?: string | number;
  part_type?: string;
  body?: string | null;
  redacted?: boolean;
  author?: { type?: string; id?: string | number };
  attachments?: unknown[];
}

export type RelayOutcome = "sent" | "duplicate" | "skipped" | "failed";

export interface RelayResult {
  status: "off" | "not_telegram" | "store_unavailable" | "done";
  parts: RelayOutcome[];
}

const ADMIN_NOTE = {
  attachments: "Telegram bridge: attachments were not sent to the learner (text only in v1).",
  undelivered: (reason: string) => `Telegram bridge: this reply was not delivered to the learner (${reason}).`,
};

async function postAdminNote(conversationId: string, adminId: string, body: string): Promise<void> {
  const res = await intercomRequest("POST", `/conversations/${encodeURIComponent(conversationId)}/reply`, {
    message_type: "note",
    type: "admin",
    admin_id: adminId,
    body: `<p>${body}</p>`,
  });
  if (!res.ok) console.warn("[tg-intercom-bridge] admin note failed", res.status);
}

/**
 * First phase, run before the webhook answers: find the Telegram chat of the
 * conversation. An unreadable store asks the route for a 503 so Intercom
 * sends the notification again (the per-part claims make that safe).
 */
export async function prepareAdminReply(
  notification: IntercomNotification,
): Promise<{ status: "off" | "not_telegram" | "store_unavailable" } | { status: "ready"; run: () => Promise<RelayResult> }> {
  if (!isTelegramIntercomBridgeEnabled()) return { status: "off" };
  const item = notification.data?.item as
    | { id?: string | number; conversation_parts?: { conversation_parts?: ConversationPart[] } }
    | undefined;
  const conversationId = item?.id != null ? String(item.id) : "";
  if (!conversationId) return { status: "not_telegram" };
  const mapped = await readRow<{ v: number; chat_id: number }>(`conv:${conversationId}`);
  if (!mapped.ok) return { status: "store_unavailable" };
  const chatId = mapped.row && typeof mapped.row.chat_id === "number" ? mapped.row.chat_id : null;
  if (chatId === null) return { status: "not_telegram" };
  const parts = item?.conversation_parts?.conversation_parts ?? [];
  return { status: "ready", run: () => relayParts(conversationId, chatId, parts) };
}

/** Both phases in one call (scripts and tests). */
export async function relayAdminReply(notification: IntercomNotification): Promise<RelayResult> {
  const prepared = await prepareAdminReply(notification);
  if (prepared.status !== "ready") return { status: prepared.status, parts: [] };
  return prepared.run();
}

async function relayParts(conversationId: string, chatId: number, parts: ConversationPart[]): Promise<RelayResult> {
  const outcomes: RelayOutcome[] = [];
  for (const part of parts) {
    if (part.part_type !== "comment" || part.author?.type !== "admin" || part.redacted || part.id == null) {
      outcomes.push("skipped");
      continue;
    }
    const partId = String(part.id);
    const adminId = part.author.id != null ? String(part.author.id) : null;
    const text = truncateText(htmlToText(part.body ?? ""));
    const hasAttachments = (Array.isArray(part.attachments) && part.attachments.length > 0) || /<img\b/i.test(part.body ?? "");

    const owned = await claim(`relay:${partId}`, { v: 1, conversation_id: conversationId, state: "pending" });
    if (owned === null) {
      if (adminId) await postAdminNote(conversationId, adminId, ADMIN_NOTE.undelivered("temporary error, please send it again"));
      outcomes.push("failed");
      continue;
    }
    if (!owned) {
      outcomes.push("duplicate");
      continue;
    }
    if (!text) {
      await writeRow(`relay:${partId}`, { v: 1, conversation_id: conversationId, state: "no_text" });
      if (hasAttachments && adminId) await postAdminNote(conversationId, adminId, ADMIN_NOTE.attachments);
      outcomes.push("skipped");
      continue;
    }
    const sent = await sendCustomerBotMessage(chatId, text);
    if (sent.ok) {
      await writeRow(`relay:${partId}`, { v: 1, conversation_id: conversationId, state: "sent" });
      if (hasAttachments && adminId) await postAdminNote(conversationId, adminId, ADMIN_NOTE.attachments);
      outcomes.push("sent");
    } else {
      // Kept claimed: a timeout may still have delivered, so never send twice.
      await writeRow(`relay:${partId}`, { v: 1, conversation_id: conversationId, state: "failed", reason: sent.reason });
      const reason = sent.reason === "blocked" ? "the learner blocked the bot or never started it" : `Telegram ${sent.reason}`;
      if (adminId) await postAdminNote(conversationId, adminId, ADMIN_NOTE.undelivered(reason));
      outcomes.push("failed");
    }
  }
  return { status: "done", parts: outcomes };
}
