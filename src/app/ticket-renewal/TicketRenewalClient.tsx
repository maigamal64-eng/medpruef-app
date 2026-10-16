"use client";
/**
 * Guarantee Ticket renewal form (a-pricing-v2). Shows the ticket end, the
 * renewal years left, a waiting request or the decision, and the form:
 * which proof (a failed official result, or a registration for a sitting
 * after the ticket ends), a file (PDF or image, 4 MB) or an https link, the
 * sitting date for a registration, an optional note. One idempotency key per
 * attempt, reused on retry. Terms from src/lib/pricing-v2/ticket.ts. Sie.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { authFetch as fetch } from "@/lib/authFetch";
import { useLang } from "@/lib/i18n";
import { useSignedInRoute } from "@/lib/hooks/useSignedInRoute";
import { Alert, AppLayout, Skeleton } from "@/components/ui";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import { getStoredSession } from "@/lib/auth";
import { TICKET_PROOF_TYPES, ticketNotRefund, ticketTerms } from "@/lib/pricing-v2/ticket";
import { BILLING_SUPPORT_EMAIL } from "@/lib/billing-copy";

interface State {
  ticket: { expires_at: string | null; status: string } | null;
  renewals_used: number;
  max_renewals: number;
  pending: { kind: string; created_at: string } | null;
  history: Array<{ kind: string; status: string; created_at: string; decided_at: string | null; new_expires_at: string | null; decision_reason: string | null }>;
  blocker: string | null;
}

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : "00000000-0000-4000-8000-000000000000";
}

export default function TicketRenewalClient() {
  const ready = useSignedInRoute();
  const lang = useLang();
  const de = lang === "de";
  const bl = de ? "de" : "en";
  const [state, setState] = useState<State | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [kind, setKind] = useState<"failed_result" | "booked_sitting">("failed_result");
  const [sittingDate, setSittingDate] = useState("");
  const [link, setLink] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const key = useRef<string>(newKey());
  // Read after mount: the server render has no session (hydration must match).
  const [user, setUser] = useState<{ id: string; first_name?: string } | null>(null);
  useEffect(() => { setUser(getStoredSession()?.user ?? null); }, []);

  const date = (iso: string | null) => iso ? new Intl.DateTimeFormat(de ? "de-AT" : "en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Vienna" }).format(new Date(iso)) : "";

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const r = await fetch("/api/ticket-renewal", { timeoutMs: 8_000 });
      if (!r.ok) throw new Error(String(r.status));
      setState(await r.json());
    } catch { setLoadError(true); }
  }, []);
  useEffect(() => { if (ready) void load(); }, [ready, load]);

  const submit = async () => {
    const file = fileRef.current?.files?.[0] ?? null;
    if (!file && !link.trim()) { setResult({ ok: false, text: de ? "Bitte laden Sie eine Datei hoch oder geben Sie einen Link an." : "Please upload a file or give a link." }); return; }
    if (kind === "booked_sitting" && !sittingDate) { setResult({ ok: false, text: de ? "Bitte geben Sie das Datum des gebuchten Termins an." : "Please give the date of the booked sitting." }); return; }
    setBusy(true); setResult(null);
    const form = new FormData();
    form.set("idempotency_key", key.current);
    form.set("kind", kind);
    if (file) form.set("proof", file); else form.set("proof_link", link.trim());
    if (kind === "booked_sitting") form.set("sitting_date", sittingDate);
    if (note.trim()) form.set("note", note.trim());
    try {
      const r = await fetch("/api/ticket-renewal", { method: "POST", body: form, timeoutMs: 30_000 });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        setResult({ ok: true, text: de ? "Danke. Ihr Nachweis ist eingegangen. Wir prüfen ihn in der Regel innerhalb weniger Werktage." : "Thank you. Your proof has arrived. We usually check it within a few working days." });
        key.current = newKey();
        await load();
      } else {
        const code = d?.code as string | undefined;
        const text = code === "SITTING_NOT_AFTER_END" ? (de ? "Der gebuchte Termin muss nach dem Ende Ihres Tickets liegen." : "The booked sitting must be after your ticket ends.")
          : code === "FILE_TOO_LARGE" ? (de ? "Die Datei ist größer als 4 MB." : "The file is larger than 4 MB.")
          : code === "FILE_TYPE" ? (de ? "Bitte laden Sie ein PDF oder ein Bild (PNG, JPEG, WebP) hoch." : "Please upload a PDF or an image (PNG, JPEG, WebP).")
          : code === "PENDING" ? (de ? "Ein Antrag wartet bereits auf die Prüfung." : "A request is already waiting for review.")
          : code === "NOT_ELIGIBLE" ? (de ? "Für Ihr Konto ist gerade keine Verlängerung möglich." : "No renewal is possible for your account right now.")
          : (de ? "Das hat nicht geklappt. Bitte versuchen Sie es erneut." : "That did not work. Please try again.");
        setResult({ ok: false, text });
      }
    } catch {
      setResult({ ok: false, text: de ? "Keine Verbindung. Ihr Formular bleibt erhalten, bitte versuchen Sie es erneut." : "No connection. Your form is kept, please try again." });
    }
    setBusy(false);
  };

  const endMs = state?.ticket?.expires_at ? Date.parse(state.ticket.expires_at) : NaN;
  const ended = Number.isFinite(endMs) && endMs <= Date.now();
  const blockerText = (b: string | null) => {
    if (b === "no_ticket") return de ? "Für Ihr Konto ist kein Garantie-Ticket hinterlegt." : "There is no Guarantee Ticket on your account.";
    if (b === "cap_reached") return de ? "Sie haben beide kostenlosen Verlängerungsjahre bereits erhalten." : "You have already received both free renewal years.";
    if (b === "too_late") return de ? `Ihr Ticket ist seit mehr als 30 Tagen abgelaufen. Schreiben Sie uns bei Fragen an ${BILLING_SUPPORT_EMAIL}.` : `Your ticket ended more than 30 days ago. If you have questions, write to ${BILLING_SUPPORT_EMAIL}.`;
    if (b === "pending") return de ? "Ihr Antrag wartet auf die Prüfung." : "Your request is waiting for review.";
    return de ? "Gerade ist keine Verlängerung möglich." : "No renewal is possible right now.";
  };

  return (
    <AppLayout sidebar={<Sidebar lang={lang} userId={user?.id} userName={user?.first_name} />} bottomNav={<BottomNav lang={lang} userId={user?.id} />}>
      <main className="main-content safe-area-top safe-area-bottom bg-[var(--mp-surface-sunken)] pb-24">
        <section className="max-w-3xl mx-auto px-4 lg:px-8 pt-6 space-y-4">
          <h1 className="mp-h2 m-0">{de ? "Garantie-Ticket: kostenloses Verlängerungsjahr" : "Guarantee Ticket: free renewal year"}</h1>
          {!ready || (!state && !loadError) ? <Skeleton className="h-32 w-full" /> : null}
          {loadError && <Alert variant="error" title={de ? "Konnte nicht geladen werden" : "Could not load"}><button type="button" className="underline min-h-11" onClick={() => void load()}>{de ? "Erneut versuchen" : "Try again"}</button></Alert>}
          {state && (
            <>
              {state.ticket && (
                <p className="mp-card p-4 text-sm m-0" data-ticket-status>
                  {ended
                    ? de ? `Ihr Ticket ist am ${date(state.ticket.expires_at)} abgelaufen.` : `Your ticket ended on ${date(state.ticket.expires_at)}.`
                    : de ? `Ihr Ticket läuft bis ${date(state.ticket.expires_at)}.` : `Your ticket runs until ${date(state.ticket.expires_at)}.`}
                  {" "}
                  {de ? `Verlängerungsjahre erhalten: ${state.renewals_used} von ${state.max_renewals}.` : `Renewal years received: ${state.renewals_used} of ${state.max_renewals}.`}
                </p>
              )}
              {state.blocker ? (
                <Alert variant={state.blocker === "pending" ? "info" : "warning"} title={blockerText(state.blocker)}>{null}</Alert>
              ) : (
                <form className="mp-card p-5 space-y-4" onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
                  <fieldset className="m-0 p-0 border-0 space-y-2">
                    <legend className="text-sm font-semibold mb-1">{de ? "Ihr Nachweis" : "Your proof"}</legend>
                    <label className="flex items-start gap-3 min-h-11 text-sm"><input type="radio" name="kind" className="mt-1 size-4" checked={kind === "failed_result"} onChange={() => setKind("failed_result")} />{de ? "Offizielles Ergebnis: Ich habe eine Prüfung nicht bestanden" : "Official result: I did not pass an exam"}</label>
                    <label className="flex items-start gap-3 min-h-11 text-sm"><input type="radio" name="kind" className="mt-1 size-4" checked={kind === "booked_sitting"} onChange={() => setKind("booked_sitting")} />{de ? "Anmeldebestätigung für einen Termin nach dem Ende meines Tickets" : "Registration confirmation for a sitting after my ticket ends"}</label>
                  </fieldset>
                  {kind === "booked_sitting" && (
                    <label className="block text-sm">
                      <span className="font-semibold">{de ? "Datum des gebuchten Termins" : "Date of the booked sitting"}</span>
                      <input type="date" className="mp-field mt-1 block w-full min-h-11" value={sittingDate} onChange={(e) => setSittingDate(e.target.value)} />
                    </label>
                  )}
                  <label className="block text-sm">
                    <span className="font-semibold">{de ? "Datei (PDF oder Bild, höchstens 4 MB)" : "File (PDF or image, at most 4 MB)"}</span>
                    <input ref={fileRef} type="file" accept={TICKET_PROOF_TYPES.join(",")} className="mt-1 block w-full min-h-11 text-sm" />
                  </label>
                  <label className="block text-sm">
                    <span className="font-semibold">{de ? "Oder ein Link (https)" : "Or a link (https)"}</span>
                    <input type="url" inputMode="url" className="mp-field mt-1 block w-full min-h-11" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" />
                  </label>
                  <label className="block text-sm">
                    <span className="font-semibold">{de ? "Notiz (optional)" : "Note (optional)"}</span>
                    <textarea className="mp-field mt-1 block w-full" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
                  </label>
                  <p className="mp-small text-[var(--mp-fg-muted)] m-0">{de ? "Bitte schwärzen Sie, was wir nicht brauchen (zum Beispiel Ausweisnummern). Nur MedPrüf-Admins sehen den Nachweis, und wir löschen die Datei 30 Tage nach der Entscheidung." : "Please black out what we do not need (for example ID numbers). Only MedPrüf admins see the proof, and we delete the file 30 days after the decision."}</p>
                  <button type="submit" className="mp-btn mp-btn--success min-h-12" aria-disabled={busy} disabled={busy}>{busy ? (de ? "Wird gesendet" : "Sending") : (de ? "Nachweis senden" : "Send proof")}</button>
                </form>
              )}
              {result && <p role={result.ok ? "status" : "alert"} className="mp-card p-4 text-sm m-0">{result.text}</p>}
              {state.history.filter((h) => h.status !== "pending").length > 0 && (
                <section className="mp-card p-4 text-sm space-y-1">
                  <h2 className="mp-h3 m-0">{de ? "Bisherige Entscheidungen" : "Earlier decisions"}</h2>
                  {state.history.filter((h) => h.status !== "pending").map((h) => (
                    <p key={h.created_at} className="m-0">{h.status === "approved"
                      ? (de ? `Genehmigt am ${date(h.decided_at)}, Zugang bis ${date(h.new_expires_at)}.` : `Approved on ${date(h.decided_at)}, access until ${date(h.new_expires_at)}.`)
                      : (de ? `Abgelehnt am ${date(h.decided_at)}${h.decision_reason ? `: ${h.decision_reason}` : "."}` : `Declined on ${date(h.decided_at)}${h.decision_reason ? `: ${h.decision_reason}` : "."}`)}</p>
                  ))}
                </section>
              )}
            </>
          )}
          <details className="mp-card p-4 text-sm">
            <summary className="cursor-pointer min-h-11 flex items-center font-semibold">{de ? "Die Regeln" : "The rules"}</summary>
            <dl className="space-y-2 m-0 mt-2">
              {ticketTerms(bl, null).map((row) => <div key={row.label}><dt className="font-semibold">{row.label}</dt><dd className="m-0 text-[var(--mp-fg-muted)]">{row.value}</dd></div>)}
            </dl>
            <p className="mt-2 mb-0 text-[var(--mp-fg-muted)]">{ticketNotRefund(bl)}</p>
          </details>
        </section>
      </main>
    </AppLayout>
  );
}
