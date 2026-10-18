/**
 * Switch of the link-Telegram path (a-trial-phone-gate, [name] 17 Oct decision
 * trial-phone-backed).
 *
 *   TELEGRAM_LINK_ENABLED   server, default OFF: only the literal "true"
 *                           lets a signed-in account without Telegram ask for
 *                           a bot deep link (POST /api/telegram/link), lets
 *                           the bot bind the Telegram that opens it, and
 *                           shows the "Telegram verbinden" prompts on Home,
 *                           /pricing and the claim card.
 *
 * The Telegram requirement of the reverse trial itself is NOT behind this
 * flag: since this job every new reverse trial and every claim needs a
 * linked Telegram id. With this flag off, an email-only account simply keeps
 * the free tier and sees no prompt.
 *
 * The link also needs REMINDER_LINK_SIGNING_SECRET (the deep link is signed
 * with it); without the secret the prompt stays hidden.
 *
 * Pure: reads only the env object it is given, so tests pass their own.
 */
import { telegramLinksConfigured } from "./token";

type Env = Record<string, string | undefined>;

export function telegramLinkEnabled(env?: Env): boolean {
  const source = env ?? process.env;
  return source.TELEGRAM_LINK_ENABLED === "true" && telegramLinksConfigured(source);
}
