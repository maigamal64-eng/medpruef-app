"use client";
/**
 * SupportContactForm (LX-31, UX-PUB-10): the contact path for visitors without
 * a session on /faq, /pricing and /login. Signed-in learners also keep the
 * messenger. The form shows only while POST /api/support/contact is enabled
 * (SUPPORT_CONTACT_ENABLED, default off); otherwise the mailbox line stands
 * alone, so no page ever offers a form that cannot be sent.
 * Copy in formal Sie; the reply promise comes from billing-copy (one owner).
 */
import { useEffect, useId, useRef, useState } from "react";
import { BILLING_SUPPORT_EMAIL, SUPPORT_REPLY_PROMISE } from "@/lib/billing-copy";
import { SUPPORT_MESSAGE_MAX, SUPPORT_MESSAGE_MIN, type SupportTopic } from "@/lib/support-contact";
import { Button, Select, TextField, Textarea } from "@/components/ui";

type Lang = "de" | "en";
type Phase = "idle" | "sending" | "sent" | "error" | "limited";

const COPY = {
  de: {
    title: "Kontakt ohne Konto",
    intro: "Schreiben Sie uns, auch wenn Sie nicht angemeldet sind.",
    mail: "E-Mail an",
    email: "Ihre E-Mail-Adresse",
    topic: "Thema",
    message: "Ihre Nachricht",
    helper: `Mindestens ${SUPPORT_MESSAGE_MIN} Zeichen. Bitte keine Kartendaten.`,
    send: "Nachricht senden",
    sending: "Wird gesendet",
    sent: "Danke, Ihre Nachricht ist angekommen. Wir antworten an die angegebene E-Mail-Adresse.",
    error: "Nicht gesendet. Bitte versuchen Sie es noch einmal oder schreiben Sie direkt an",
    limited: "Sie haben gerade mehrere Nachrichten gesendet. Bitte warten Sie einige Minuten.",
    invalidEmail: "Bitte geben Sie eine gültige E-Mail-Adresse ein.",
    invalidMessage: `Bitte schreiben Sie zwischen ${SUPPORT_MESSAGE_MIN} und ${SUPPORT_MESSAGE_MAX} Zeichen.`,
    topics: { payment: "Zahlung", access: "Zugang oder Anmeldung", account: "Konto", content: "Fragen und Inhalte", other: "Anderes" },
  },
  en: {
    title: "Contact without an account",
    intro: "Write to us even if you are not signed in.",
    mail: "Email",
    email: "Your email address",
    topic: "Topic",
    message: "Your message",
    helper: `At least ${SUPPORT_MESSAGE_MIN} characters. Please no card details.`,
    send: "Send message",
    sending: "Sending",
    sent: "Thank you, your message has arrived. We reply to the email address you gave.",
    error: "Not sent. Please try again or write directly to",
    limited: "You have just sent several messages. Please wait a few minutes.",
    invalidEmail: "Please enter a valid email address.",
    invalidMessage: `Please write between ${SUPPORT_MESSAGE_MIN} and ${SUPPORT_MESSAGE_MAX} characters.`,
    topics: { payment: "Payment", access: "Access or sign-in", account: "Account", content: "Questions and content", other: "Other" },
  },
} as const;

export default function SupportContactForm({ lang, defaultTopic = "other", className = "" }: { lang: Lang; defaultTopic?: SupportTopic; className?: string }) {
  const c = COPY[lang];
  const headingId = useId();
  const [enabled, setEnabled] = useState(false);
  const [email, setEmail] = useState("");
  const [topic, setTopic] = useState<SupportTopic>(defaultTopic);
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [fieldError, setFieldError] = useState<"email" | "message" | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/support/contact", { signal: controller.signal, cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setEnabled(d?.enabled === true))
      .catch(() => setEnabled(false));
    return () => controller.abort();
  }, []);

  useEffect(() => { if (phase === "sent") statusRef.current?.focus(); }, [phase]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (phase === "sending") return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) { setFieldError("email"); emailRef.current?.focus(); return; }
    const length = message.trim().length;
    if (length < SUPPORT_MESSAGE_MIN || length > SUPPORT_MESSAGE_MAX) { setFieldError("message"); messageRef.current?.focus(); return; }
    setFieldError(null); setPhase("sending");
    try {
      const response = await fetch("/api/support/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, topic, message, website, page: window.location.pathname, lang }),
        signal: AbortSignal.timeout(15_000),
      });
      if (response.ok) { setPhase("sent"); setMessage(""); return; }
      setPhase(response.status === 429 ? "limited" : "error");
    } catch {
      setPhase("error");
    }
  };

  const mailLine = (
    <p className="text-sm text-[var(--mp-fg-muted)]">
      {c.mail} <a className="underline inline-flex min-h-11 items-center" href={`mailto:${BILLING_SUPPORT_EMAIL}`}>{BILLING_SUPPORT_EMAIL}</a>. {SUPPORT_REPLY_PROMISE[lang]}
    </p>
  );

  return (
    <section aria-labelledby={headingId} className={`mp-card p-5 space-y-3 ${className}`}>
      <h2 id={headingId} className="mp-h3">{c.title}</h2>
      {mailLine}
      {enabled && phase !== "sent" && (
        <form onSubmit={submit} noValidate className="space-y-3">
          <p className="text-sm text-[var(--mp-fg-muted)]">{c.intro}</p>
          <TextField ref={emailRef} label={c.email} type="email" autoComplete="email" required value={email}
            onChange={(e) => setEmail(e.target.value)} error={fieldError === "email" ? c.invalidEmail : undefined} />
          <Select label={c.topic} value={topic} onChange={(e) => setTopic(e.target.value as SupportTopic)}
            options={(Object.keys(c.topics) as SupportTopic[]).map((value) => ({ value, label: c.topics[value] }))} />
          <Textarea ref={messageRef} label={c.message} required rows={5} maxLength={SUPPORT_MESSAGE_MAX} value={message}
            onChange={(e) => setMessage(e.target.value)} helper={c.helper} error={fieldError === "message" ? c.invalidMessage : undefined} />
          {/* Honeypot: hidden from people and assistive technology. */}
          <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", width: 1, height: 1, overflow: "hidden" }}>
            <label>Website<input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} name="website" /></label>
          </div>
          <Button type="submit" variant="primary" className="min-h-12" loading={phase === "sending"} loadingLabel={c.sending}>{c.send}</Button>
          {phase === "error" && <p role="alert" className="text-sm text-[var(--mp-error-text)]">{c.error} <a className="underline" href={`mailto:${BILLING_SUPPORT_EMAIL}`}>{BILLING_SUPPORT_EMAIL}</a>.</p>}
          {phase === "limited" && <p role="alert" className="text-sm text-[var(--mp-error-text)]">{c.limited}</p>}
        </form>
      )}
      {phase === "sent" && <p ref={statusRef} tabIndex={-1} role="status" className="text-sm">{c.sent}</p>}
    </section>
  );
}
