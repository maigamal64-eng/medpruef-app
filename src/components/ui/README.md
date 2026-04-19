# MPDS v2 React primitives

Accessible, token-aware React wrappers around the `.mp-*` CSS classes defined in `src/app/globals.css`. Import from `@/components/ui`:

```tsx
import { Dialog, DialogFooter, useToast, ToastProvider, TextField, Textarea, Select, Alert, EmptyState } from '@/components/ui'
```

Canonical design reference: `design-system/components_v2.css` + `design-system/MPDS-PICKS.md`.

---

## Dialog — `<Dialog>`

Replaces the 7 hand-rolled modals in the app. A11y baked in: focus trap, escape to close, return focus on close, aria-modal, aria-labelledby, body scroll lock, reduced-motion respect.

```tsx
const [open, setOpen] = useState(false)

<Dialog
  open={open}
  onOpenChange={setOpen}
  title="Frage melden"
  description="Was stimmt mit dieser Frage nicht?"
  footer={
    <>
      <button className="mp-btn mp-btn--secondary" onClick={() => setOpen(false)}>Abbrechen</button>
      <button className="mp-btn mp-btn--primary" onClick={handleSubmit}>Senden</button>
    </>
  }
>
  <Textarea label="Details" rows={4} value={text} onChange={e => setText(e.target.value)} />
</Dialog>
```

**Props:** `open`, `onOpenChange`, `title`, `description?`, `children?`, `footer?`, `closeOnBackdrop?` (default true), `closeOnEscape?` (default true), `hideCloseButton?`, `maxWidth?` (default 440px).

---

## BottomSheet — `<BottomSheet>`

Anchored slide-in surface: bottom sheet on mobile (`< lg`), right-side drawer on desktop (`>= lg`). Use when the user should still see the context behind the surface — e.g. AI chat about a question while the question stays visible.

```tsx
<BottomSheet
  open={open}
  onOpenChange={setOpen}
  title="KI-Erklärung"
  description="Bezug: Frage 7 · Kardiologie"
  footer={
    <div className="flex gap-2 p-3">
      <input className="mp-field__input flex-1" placeholder="Folgefrage stellen..." />
      <button className="mp-btn mp-btn--primary">Senden</button>
    </div>
  }
>
  <MessageList messages={messages} />
</BottomSheet>
```

**Props:** `open`, `onOpenChange`, `title`, `description?`, `children?`, `footer?`, `position?` (`"auto" | "bottom" | "right"`, default `"auto"`), `width?` (desktop drawer width, default `"420px"`), `closeOnBackdrop?` (default true), `closeOnEscape?` (default true), `hideCloseButton?`, `ariaDescribedBy?`, `surfaceClassName?`.

**Behavior:**
- `"auto"` resolves to `"bottom"` below 1024px (Tailwind `lg`) and `"right"` at/above it. Responds live to viewport resizes.
- Mobile: slides up from the bottom, max-height 85vh, rounded top corners, grab handle with swipe-down-to-close (threshold 120px).
- Desktop: slides in from the right, full height, rounded left corners, default 420px wide (override with `width`).
- Backdrop dims the surface behind but keeps it partially visible — unlike centered `<Dialog>` which opaquely overlays it.
- Inherits every a11y guarantee from `<Dialog>`: focus trap, return focus, Esc closes, body scroll lock, `aria-modal`, `aria-labelledby`, reduced-motion respect.

---

## Toast — `useToast()`

`<ToastProvider>` is already mounted in `src/app/layout.tsx` — any component in the tree can call `useToast()`:

```tsx
const toast = useToast()

toast.success("Antwort gespeichert")
toast.error("Konnte nicht speichern", "Prüfe deine Internetverbindung")
toast.warning("Streak endet in 3h")
toast.info("Übersetze auf Russisch…")
toast.show({ title: "Läuft…", variant: "info", duration: 0 }) // 0 = persistent
```

Toasts render into a single `aria-live="polite"` region. Hover/focus pauses auto-dismiss.

**Default durations:** success/info 4.2s, warning 5s, error 6s, custom via `duration: ms` (0 = persistent).

---

## Form fields — `<TextField>`, `<Textarea>`, `<Select>`

Labeled form controls with helper text, error state, and ARIA wiring:

```tsx
<TextField
  label="E-Mail"
  type="email"
  required
  helper="Wir mailen dir Prüfungsupdates."
  error={emailError}
  value={email}
  onChange={e => setEmail(e.target.value)}
/>

<Textarea label="Feedback" rows={4} helper="Optional." />

<Select
  label="Sprache"
  options={[
    { value: 'de', label: 'Deutsch' },
    { value: 'en', label: 'English' },
  ]}
  value={lang}
  onChange={e => setLang(e.target.value)}
/>
```

All three forward native input/textarea/select props via `...rest`, so `placeholder`, `pattern`, `maxLength`, `autoFocus`, etc. all work.

---

## Alert — `<Alert>`

Inline banner for persistent status messages (above forms, inside cards). For transient messages use toasts.

```tsx
<Alert variant="warning" title="Streak endet in 3 Stunden">
  Beantworte heute mindestens eine Frage, um deinen 7-Tage-Streak zu halten.
</Alert>

<Alert variant="error" title="Speichern fehlgeschlagen" onClose={() => setError(null)}>
  Wir konnten dein Profil nicht aktualisieren. Versuche es nochmal.
</Alert>
```

**Variants:** `info` (default) · `success` · `warning` · `error`. Error variant auto-uses `role="alert"`; others use `role="status"`.

---

## EmptyState — `<EmptyState>`

For "nothing here yet" surfaces. Redesigned 2026-04-17 to match alt Empty-A (illustrated, warm) — the art surface is now a 120px tinted rounded chip holding a big icon (48px) or inline SVG. Copy is written in MedPrüf's voice, not stripped to "No X yet".

```tsx
<EmptyState
  tone="success"
  icon={<Bookmark className="w-10 h-10" aria-hidden />}
  title="Noch keine Fragen markiert"
  body="Tippe auf das Fähnchen bei einer Frage, um sie hier zu sehen. Du kannst alle gemerkten Fragen später im Übungsmodus filtern."
  action={
    <button className="mp-btn mp-btn--secondary" onClick={goToQuiz}>
      Quiz starten
    </button>
  }
/>
```

**Props:** `title`, `icon?`, `body?`, `action?`, `className?`, `tone?` (default `"neutral"`).

**Tone** tints the art chip background to match the mood of the empty:
- `"neutral"` — info blue tint, generic "nothing here yet" lists
- `"success"` — viridian tint, positive empties ("Alles erledigt!")
- `"warning"` — amber tint, partial / offline / needs-attention states

The art area is 120×120px with an auto-sized icon slot (default 48px). Pass a Lucide icon at `w-10 h-10`/`w-12 h-12` or a small inline SVG — both will center correctly. No external illustration assets needed.

---

## Migration guide (porting legacy components)

1. **Modals** → `<Dialog>`. Grep for `fixed inset-0 z-` + `animate-scale-in` to find hand-rolled modals. Each port removes ~30 LOC of backdrop/z-index/escape-key boilerplate AND fixes missing focus trap.
2. **Form inputs** → `<TextField>` / `<Textarea>` / `<Select>`. Grep for `bg-[#F7F9FC] border border-[#E4E9F0] rounded-lg`.
3. **Inline banners** → `<Alert>`. Grep for `bg-[#EAF3F9]`, `bg-[#FFF4E6]`, `bg-[#FDECEC]`.
4. **Transient messages** → `useToast()`. Grep for one-off `setMessage(...) ; setTimeout(...)` patterns.
5. **Raw hex color classes** → CSS variables. `text-[#1A2B3C]` → `text-[var(--mp-fg)]`, `bg-[#F7F9FC]` → `bg-[var(--mp-surface-sunken)]`, `border-[#E4E9F0]` → `border-[var(--mp-border)]`. This removes the need for `[data-theme="dark"]` class overrides (DD-02/03).

---

## BrandedLoader — `<BrandedLoader>`

Picked loader alt (Loader-A · EKG-Pulse): a viridian sinus-rhythm trace that travels across the viewbox every 1.8s. Clinical metaphor, domain-native motion. Replaces the earlier ring+ü loader and the ad-hoc bouncing-dots fallback.

```tsx
<BrandedLoader />                               // default 120px EKG + "Laden…" + "medprüf · sinus rhythm"
<BrandedLoader size={60} hideLabel />           // inline compact
<BrandedLoader fullscreen label="Verbinde…" />  // route-transition overlay
```

Props: `size?` (default 120 — width; height follows the 3:1 EKG aspect), `label?` (default "Laden…"), `hideLabel?`, `fullscreen?`, `className?`. Has `role="status"` + `aria-live="polite"`. Animation lives in `@keyframes mp-loader-ekg` (`src/app/globals.css`) and honors `prefers-reduced-motion` (trace stays centered and static).

---

## Skeleton — `<Skeleton>`

Placeholder primitive with 6 variants covering most MedPrüf surfaces. Pulses on `motion-safe`, stays still for reduced-motion users.

```tsx
<Skeleton className="h-10 w-64" />              // default block
<Skeleton variant="text" lines={3} />           // paragraph lines
<Skeleton variant="avatar" />                   // 40px circle
<Skeleton variant="card" />                     // mini card with title + text
<Skeleton variant="topic-card" />               // matches TopicCard shape
<Skeleton variant="question" />                 // question stem + 4 choice rows
```

---

## Switch — `<Switch>`

Accessible `<button role="switch">` toggle (resolves DD-14). Use for boolean settings; pair with `<Alert>` for warning copy, or `<TextField>` for string/number settings.

```tsx
<Switch
  checked={darkMode}
  onChange={setDarkMode}
  label="Dunkelmodus"
  description="Nutzt dunklere Hintergründe — schont die Augen beim Lernen am Abend."
/>
```

Props: `checked`, `onChange`, `label`, `description?`, `disabled?`, `hideLabel?`. Keyboard: Space/Enter toggles; visible focus ring.

---

## AchievementRank — `<AchievementRank>`

Bespoke SVG glyph set for the 8 MedPrüf rank tiers (resolves DD-04). Replaces the emoji rank icons that rendered inconsistently across Apple/Windows/Google platforms, and removes the 🩺/⚕️/🔬 cross-platform ambiguity. Each glyph is a 24×24 line drawing at 1.75 stroke weight, so it scales cleanly from 20px inline badges up to 64px hero badges.

```tsx
<AchievementRank tier={3} />                             // 40px gradient badge (default)
<AchievementRank tier={5} size={64} />                   // big hero-card badge
<AchievementRank tier={2} size={20} variant="inline" />  // compact row (no chip)
<AchievementRank tier={rankFromName(xpInfo.rank)} />     // map from rank name
```

**Props:** `tier` (1–8, required), `size?` (default 40, scales 20–64), `variant?` (`"badge"` default / `"inline"`), `className?`, `aria-hidden?`, `aria-label?` (auto-generated as `"Rang N: <name>"`).

**Exports:** `AchievementRank`, `RANK_NAMES_BY_TIER` (the canonical tier→name map, matches `getLevelFromXP`), `rankFromName(name)` convenience helper, and the `RankTier` type (`1|2|...|8`).

**The 8 glyphs — one per rank, each progresses in visual complexity:**

| Tier | Rank           | Glyph                                                       |
|------|----------------|-------------------------------------------------------------|
| 1    | Praktikant     | Stethoscope — chest piece + twin earpiece tubes             |
| 2    | Famulant       | Open book with a small medical cross on the spine           |
| 3    | PJ-Student     | Heart outline with an EKG waveform traversing through it    |
| 4    | Assistenzarzt  | Medical cross inside a rounded-square frame                 |
| 5    | Facharzt       | Cross flanked by twin laurel branches (specialist earned)   |
| 6    | Oberarzt       | Hospital building silhouette with cross on the facade       |
| 7    | Chefarzt       | Three-point crown sitting atop a cross (head of ward)       |
| 8    | Professor      | Graduation cap crowned by a laurel wreath                   |

**Variants:**
- `"badge"` — Oxford Blue → CTA Blue gradient chip (matches `.mp-rank` in globals.css), white glyph. Use on hero cards, sidebar user rows, primary surfaces.
- `"inline"` — glyph only, no chip. Inherits `currentColor` from its parent. Use in compact rows, list items, or wherever the chip would be visual noise.

**Accessibility:** `role="img"` + `aria-label="Rang N: <rank>"` by default. If a sibling text element already states the rank, pass `aria-hidden` to silence the redundant announcement.

---

## Migration guide (porting legacy components)

1. **Modals** → `<Dialog>`. Grep for `fixed inset-0 z-` + `animate-scale-in` to find hand-rolled modals. Each port removes ~30 LOC of backdrop/z-index/escape-key boilerplate AND fixes missing focus trap.
2. **Form inputs** → `<TextField>` / `<Textarea>` / `<Select>`. Grep for `bg-[#F7F9FC] border border-[#E4E9F0] rounded-lg`.
3. **Inline banners** → `<Alert>`. Grep for `bg-[#EAF3F9]`, `bg-[#FFF4E6]`, `bg-[#FDECEC]`.
4. **Transient messages** → `useToast()`. Grep for one-off `setMessage(...) ; setTimeout(...)` patterns.
5. **Toggles** → `<Switch>`. Grep for `<div onClick.*role` or hand-rolled pill toggles.
6. **Loading states** → `<BrandedLoader>` or `<Skeleton>`. Grep for `branded-loader` class usage or `animate-pulse` placeholders.
7. **Emoji rank icons** → `<AchievementRank>`. Grep for 🎓 / 📚 / 🩺 / ⚕️ / 🏥 / 🔬 / 👨‍⚕️ / 🏆 used as rank identifiers (see XPBar + GamificationHero for reference).
8. **Raw hex color classes** → CSS variables. `text-[#1A2B3C]` → `text-[var(--mp-fg)]`, `bg-[#F7F9FC]` → `bg-[var(--mp-surface-sunken)]`, `border-[#E4E9F0]` → `border-[var(--mp-border)]`. This removes the need for `[data-theme="dark"]` class overrides (DD-02/03).

---

## What's NOT in here yet

Tracked in `design-system/DESIGN-DEBT.md`:

- `<Tabs>` — React wrapper around `.mp-tabs` (CSS works fine without a wrapper for simple cases)
- `<Sparkline>` chart primitive (blocked on chart palette being tokenized)

When you need one of these, add it here, follow the pattern from existing primitives (forwardRef if appropriate, a11y-first, docstring with usage example), and update this README.
