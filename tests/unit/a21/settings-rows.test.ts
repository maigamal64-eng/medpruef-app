import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { settingsBuildLabel } from '@/components/settings/build-label';

const ROOT = join(__dirname, '..', '..', '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

const settings = read('src/app/settings/page.tsx');
const pwa = read('src/components/PWAInstall.tsx');
const feedback = read('src/components/FeedbackWidget.tsx');
const picker = read('src/components/LanguagePicker.tsx');
const theme = read('src/components/ThemeToggle.tsx');

describe('a21 Settings rows (UX-ACC-20/38/39)', () => {
  it('drops the fake version and the reminders placeholder', () => {
    expect(settings).not.toContain('MedPrüf v1.0');
    expect(settings).not.toContain('MedPr&uuml;f v1.0');
    expect(settings).not.toContain('Erinnerungen · bald');
    expect(settings).toContain('settingsBuildLabel()');
  });

  it('has the plan row labels for free and paid learners', () => {
    expect(settings).toContain('Pro freischalten, ab ${monthlyFrom} pro Monat');
    // a-pricing-v2: the entry price follows the offer (19 € today, 24 € with v2).
    expect(settings).toContain('billingAmount(entryMonthlyCents()');
    expect(settings).toContain('"Abo und Zahlung"');
    expect(settings).toContain('id="abo-und-zahlung"');
  });

  it('renders the account rows as buttons, not next/link (styled-jsx scope)', () => {
    expect(settings).not.toMatch(/<Link[^>]*className="set-row/);
    expect(settings).toContain('router.push("/pricing")');
    expect(settings).toContain('router.push("/history")');
  });

  it('names exactly what clear-data removes and confirms logout', () => {
    expect(settings).toContain('Notizen, Lesezeichen und Zwischenstand löschen');
    expect(settings).toContain('Löscht Ihre Notizen zu Fragen auf diesem Gerät, alle Lesezeichen in Ihrem Konto und den Quiz-Zwischenstand. Lernfortschritt und Abo bleiben erhalten.');
    expect(settings).toContain('"medpruef_quiz_session_v2"');
    expect(settings).toMatch(/<ConfirmAction[\s\S]*open=\{logoutConfirmOpen\}/);
    expect(settings).toContain('countPendingAnswers(userId)');
  });

  it('reuses the shared exam picker for Aktive Prüfung', () => {
    expect(settings).toContain('<ExamSwitcherInline variant="header" />');
  });

  it('never labels the Whop link as a verified cancellation while VERIFIED_CANCEL_PATH is off', () => {
    expect(settings).toContain('Abo bei Whop verwalten (öffnet Whop in einem neuen Tab, Seite auf Englisch)');
    expect(settings).toContain('canManage && VERIFIED_CANCEL_PATH');
    expect(settings).toContain('Rückerstattung innerhalb von 7 Tagen nach einem Kauf: schreiben Sie an ');
    expect(settings).toContain('Die Erstattung erfolgt über Whop.');
    expect(settings).toContain('"Quittungen sendet Whop an die E-Mail-Adresse Ihres Whop-Kontos."');
  });

  it('uses tokens instead of white and amber on fills', () => {
    expect(settings).not.toMatch(/text-white|amber-\d/);
    expect(settings).not.toMatch(/rgba\(\d/);
  });
});

describe('a21 build label', () => {
  it('shows the short commit id or dev', () => {
    expect(settingsBuildLabel('abcdef123456')).toBe('abcdef1');
    expect(settingsBuildLabel('dev-local')).toBe('dev');
    expect(settingsBuildLabel('')).toBe('dev');
    expect(settingsBuildLabel(undefined)).toMatch(/^(dev|[0-9a-f]{7})$/);
  });
});

describe('a21 PWA update banner (UX-ACC-32)', () => {
  it('has no disabled attribute on the update button', () => {
    expect(pwa).not.toMatch(/(?<!aria-)disabled=/);
    expect(pwa).toContain('aria-disabled={studyInProgress || undefined}');
  });
  it('shows the reason at every width and offers a reload way out', () => {
    expect(pwa).not.toContain('hidden sm:block');
    expect(pwa).toContain('Das Update startet, sobald Sie die Lerneinheit beenden. Ihr Fortschritt bleibt erhalten.');
    expect(pwa).toContain('"Update nach dem Lernen"');
    expect(pwa).toContain('"Seite neu laden"');
    expect(pwa).toContain('role="status"');
    expect(pwa).toContain('UPDATE_STUCK_MS = 30_000');
  });
});

describe('a21 feedback, language and theme', () => {
  it('feedback thanks card is a status and the form survives route changes', () => {
    expect(feedback).toMatch(/role="status"/);
    expect(feedback).not.toContain('lastPathnameRef');
    expect(feedback).toContain('launcherRef');
  });
  it('language options carry the coverage note in their own language', () => {
    expect(picker).toContain("ru: 'частично на английском'");
    expect(picker).toContain("uk: 'частково англійською'");
    expect(picker).toContain("tr: 'kısmen İngilizce'");
    expect(picker).toContain('aria-label={triggerName}');
  });
  it('theme toggle states the action and exposes the state', () => {
    expect(theme).toContain('aria-pressed={theme === "dark"}');
    expect(theme).not.toContain('toggleLabel');
  });
});
