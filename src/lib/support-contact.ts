/**
 * Support contact (LX-31, UX-PUB-10): validation and mail body for the
 * no-session contact form on /faq, /pricing and /login. Pure, no I/O, so the
 * route and the client share one rule. Signed-in learners keep the messenger.
 *
 * Privacy: the message is mailed to the one support mailbox and never logged
 * or stored; the page context is a same-site path only (never a query string).
 */
export const SUPPORT_TOPICS = ["payment", "access", "account", "content", "other"] as const;
export type SupportTopic = (typeof SUPPORT_TOPICS)[number];

export const SUPPORT_MESSAGE_MIN = 10;
export const SUPPORT_MESSAGE_MAX = 2000;
const EMAIL = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,200}\.[A-Za-z]{2,24}$/;

export interface SupportContact {
  email: string;
  topic: SupportTopic;
  message: string;
  /** Same-site path the form was sent from, without query or hash. */
  page: string | null;
  lang: "de" | "en";
}

export type SupportValidation =
  | { ok: true; value: SupportContact }
  | { ok: false; error: "honeypot" | "email" | "message" | "topic" | "body" };

/** Same-site path only; drops query strings and hashes, rejects protocol-relative or absolute URLs. */
export function supportPage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const path = value.split(/[?#]/)[0].trim();
  if (!/^\/(?!\/)[A-Za-z0-9/_\-.]{0,120}$/.test(path)) return null;
  return path;
}

export function validateSupportContact(body: unknown): SupportValidation {
  if (!body || typeof body !== "object") return { ok: false, error: "body" };
  const input = body as Record<string, unknown>;
  // Honeypot: a hidden field people never fill; bots usually do.
  if (typeof input.website === "string" && input.website.trim() !== "") return { ok: false, error: "honeypot" };
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  if (!EMAIL.test(email)) return { ok: false, error: "email" };
  const message = typeof input.message === "string" ? input.message.trim() : "";
  if (message.length < SUPPORT_MESSAGE_MIN || message.length > SUPPORT_MESSAGE_MAX) return { ok: false, error: "message" };
  const topic = (SUPPORT_TOPICS as readonly string[]).includes(String(input.topic)) ? (input.topic as SupportTopic) : null;
  if (!topic) return { ok: false, error: "topic" };
  return { ok: true, value: { email, topic, message, page: supportPage(input.page), lang: input.lang === "en" ? "en" : "de" } };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] as string);
}

/** Mail to the support mailbox. Every visitor-supplied value is escaped. */
export function supportMail(contact: SupportContact): { subject: string; htmlBody: string } {
  return {
    subject: `[MedPrüf Kontakt] ${contact.topic}`,
    htmlBody: [
      `<p><strong>Von:</strong> ${escapeHtml(contact.email)}</p>`,
      `<p><strong>Thema:</strong> ${escapeHtml(contact.topic)} · <strong>Sprache:</strong> ${contact.lang}</p>`,
      `<p><strong>Seite:</strong> ${escapeHtml(contact.page ?? "unbekannt")}</p>`,
      `<p style="white-space:pre-wrap">${escapeHtml(contact.message)}</p>`,
      "<p>Antwort bitte direkt an die oben genannte Adresse.</p>",
    ].join("\n"),
  };
}
