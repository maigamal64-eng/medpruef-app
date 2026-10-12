/**
 * learner-names: one display label for a learner in admin lists
 * (UX-ADM-21). Name, then @telegram, then a masked email, then a short id.
 * Full emails stay on the learner page.
 */

export interface NameSource {
  id?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  telegram_username?: string | null;
  email?: string | null;
}

export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at < 1) return "hidden email";
  const local = email.slice(0, at);
  return `${local.slice(0, 2)}…${email.slice(at)}`;
}

export function learnerDisplayName(u: NameSource): string {
  const name = [u.first_name, u.last_name].filter((v) => typeof v === "string" && v.trim()).join(" ").trim();
  if (name) return name;
  if (u.telegram_username) return `@${u.telegram_username}`;
  if (u.email) return maskEmail(u.email);
  return u.id ? `Learner ${u.id.slice(0, 8)}` : "Learner";
}
