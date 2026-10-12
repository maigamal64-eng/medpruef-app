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

## BottomSheet — removed

There is no `<BottomSheet>` primitive. It existed on the April 2026 feature
branches but was never merged: `Dialog` replaced it because its desktop
drawer form was the rejected direction (see the note in
`src/components/NoteReader.tsx`). This heading is kept as a tombstone so the
component is not "re-added" from an old branch by mistake. Use `<Dialog>`.

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

---

## B.1 primitives (2026-06-25) — extracted, not yet adopted

These 10 primitives were added in Phase B.1 of the UI/UX overhaul. They wrap
existing CSS classes and fix known drift points (6-radius Options, 18 inline
style blocks in flashcards, zero `.mp-*` classes in nav). No surface imports
them yet — that is B.2/B.3/B.4.

**Radius note:** `design-system/README.md` lists "8/10/14/20" but the live
tokens in globals.css are `--mp-r-input:8, --mp-r-button:12, --mp-r-card:16,
--mp-r-modal:20`. These primitives use the live tokens. The README doc/token
mismatch should be reconciled in B.5.

---

### Button — `<Button>`

Wraps `.mp-btn` + variant modifiers. Replaces all hand-rolled `mp-btn mp-btn--primary` class chains.

```tsx
<Button variant="primary" onClick={handleSubmit}>Weiter</Button>
<Button variant="secondary" size="sm" onClick={cancel}>Abbrechen</Button>
<Button variant="ghost" loading loadingLabel="Speichere...">Speichern</Button>
<Button variant="destructive" disabled>Löschen</Button>
```

**Props:** `variant?` (`primary` | `secondary` | `success` | `ghost` | `destructive`, default `primary`), `size?` (`sm` | `md` | `lg`), `loading?`, `loadingLabel?`, `disabled?`, `className?`. Forwards all native button props. `forwardRef`.

**Consuming surfaces:** everywhere `.mp-btn` appears. Highest concentration: QuestionCard (submit), Dialog footers, settings page.

---

### Card — `<Card>`

Wraps `.mp-card` (+ `.mp-card--interactive` when `interactive`). Enforces the ONE canonical radius (`--mp-r-card`, 16px).

```tsx
<Card>
  <p>Stat content</p>
</Card>

<Card interactive onClick={handleClick} role="button" tabIndex={0}>
  Klickbare Karte
</Card>
```

**Props:** `interactive?` (adds `.mp-card--interactive` hover/active), `className?`, all `HTMLDivElement` props. `forwardRef`.

**Consuming surfaces:** stats page stat tiles, progress page sections, home page summary cards. B.3: QuestionCard's option-image wrapper.

---

### StatTile — `<StatTile>`

Wraps `.mp-stat` + `__label` + `__value` + `__trend`. Replaces hand-rolled stat tiles on the stats page.

```tsx
<StatTile label="Fragen gesamt" value={420} />
<StatTile
  label="Genauigkeit"
  value="87%"
  trend={{ direction: "up", text: "+5% diese Woche" }}
/>
```

**Props:** `label` (string), `value` (string | number), `trend?` (`{ direction: "up" | "down" | "neutral", text: string }`), `className?`.

**Consuming surfaces:** `src/app/stats/page.tsx` stat row (currently hand-rolled flex).

---

### RankBadge — `<RankBadge>`

Composes `<AchievementRank>` with an optional rank-name label. NOT a second `.mp-rank` glyph primitive — delegates rendering to AchievementRank.

```tsx
<RankBadge tier={3} showLabel />           // glyph + "PJ-Student" below
<RankBadge tier={userTier} size="lg" />   // large chip, no label
```

**Props:** `tier` (1–8), `size?` (`sm`=28px | `md`=40px | `lg`=56px, default `md`), `showLabel?`, `className?`.

**Consuming surfaces:** Sidebar user card, leaderboard rows, GamificationHero.

---

### Option — `<Option>`

Quiz/flashcard answer button. One radius (`--mp-r-card`), one state machine, zero radius drift. Fixes the 6 mixed radii (`rounded`, `rounded-sm`, `rounded-lg`, `rounded-xl`, `rounded-2xl`, `rounded-full`) in QuestionCard.tsx.

State machine (prop-driven — parent owns grading):

| state | meaning |
|-------|---------|
| `idle` | pre-answer, not selected |
| `selected` | pre-answer, user tapped this option |
| `correct` | post-answer, this option is correct |
| `wrong` | post-answer, selected but wrong |
| `disabled` | post-answer, not selected, not correct |

```tsx
<Option
  state={answered ? (opt.correct ? "correct" : selectedIdxs.has(idx) ? "wrong" : "disabled")
                   : (selectedIdxs.has(idx) ? "selected" : "idle")}
  letter={String.fromCharCode(65 + idx)}
  onClick={() => handleSelect(idx)}
>
  {opt.text}
</Option>

// Multi-correct
<Option state={...} multiSelect checked={selectedIdxs.has(idx)} letter="B">
  {opt.text}
</Option>
```

**Props:** `state?` (default `idle`), `letter?`, `multiSelect?`, `checked?`, `className?`, all button props. `forwardRef`.

**Consuming surfaces:** `src/components/QuestionCard.tsx` option list (highest traffic), `src/app/flashcards/page.tsx`.

**B.3 flag:** Option replaces `getOptionStyle()` + the inline option `<button>` in QuestionCard. Parent keeps grading state; Option is purely presentational.

---

### AnswerReveal — `<AnswerReveal>`

Post-answer feedback strip. Reproduces the live `bg-[var(--mp-surface-sunken)] rounded-xl` styling with canonical radius token + a left accent stripe (teal for correct, error red for wrong).

```tsx
<AnswerReveal correct={wasCorrect}>
  <p>{question.explanation}</p>
</AnswerReveal>

// With tab panel:
<AnswerReveal correct={wasCorrect}>
  <ContextTabs tabs={tabs} activeTab={activeTab} onTabChange={setTab} />
  <div>{tabContent}</div>
</AnswerReveal>
```

**Props:** `correct` (boolean), `className?`, `children?`. Includes `role="status"` + `aria-live="polite"`.

**Consuming surfaces:** `src/components/QuestionCard.tsx` post-answer strip (line ~528).

---

### RatingButton — `<RatingButton>`

Flashcard SM-2 confidence button. Eliminates 18 inline `style={{}}` blocks in `src/app/flashcards/page.tsx`. Intensity maps to token color:

| intensity | rating | color |
|-----------|--------|-------|
| 0 | again | `--mp-warning` (orange) |
| 1 | hard | `--mp-status-warning` (amber) |
| 2 | good | `--mp-viridian` (green) |
| 3 | easy | `--mp-cta-blue` (blue) |

```tsx
<RatingButton intensity={0} sublabel="< 10 min" onClick={() => rate("again")}>
  Nochmal
</RatingButton>
<RatingButton intensity={2} sublabel="4 Tage" onClick={() => rate("good")}>
  Gut
</RatingButton>
```

**Props:** `intensity` (0|1|2|3, required), `sublabel?`, `className?`, all button props except `style`. `forwardRef`.

**Consuming surfaces:** `src/app/flashcards/page.tsx` confidence row (lines 610–704).

---

### NavItem — `<NavItem>`

Unified nav item for Sidebar and BottomNav. Eliminates the private `navLinkClass` / `navItemClass` functions. Two contexts:

- `context="sidebar"` — dark rail, left accent stripe when active, collapsed/expanded.
- `context="bottom"` — glass bar, vertical icon+label.

```tsx
// Sidebar (expanded)
<NavItem context="sidebar" href="/quiz" icon={<FileText className="w-5 h-5" />}
  label="Quiz" active />

// Sidebar (collapsed rail)
<NavItem context="sidebar" href="/quiz" icon={<FileText className="w-5 h-5" />}
  label="Quiz" active collapsed />

// Bottom nav
<NavItem context="bottom" href="/exam" icon={<GraduationCap className="w-5 h-5" />}
  label="Prüfung" active={pathname.startsWith("/exam")} />

// With nudge dot
<NavItem context="sidebar" href="/referrals" icon={<Gift className="w-5 h-5" />}
  label="Empfehlungen" dot dotTooltip="Dein Code wartet." />
```

**Props:** `context` (`"sidebar"` | `"bottom"`), `href`, `icon`, `label`, `active?`, `collapsed?` (sidebar only), `dot?`, `dotTooltip?`, `className?`.

**Consuming surfaces:** `src/components/Sidebar.tsx`, `src/components/BottomNav.tsx`.

---

### AppLayout — `<AppLayout>`

Thin wrapper around the `.app-layout` CSS shell (`display:flex; min-height:100dvh`). Keeps surfaces from repeating `<div className="app-layout">`. Sidebar auto-hide (on /quiz and /exam) stays inside Sidebar.tsx until B.2 decides to centralize it.

```tsx
<AppLayout
  sidebar={<Sidebar lang={lang} userId={userId} totalXp={xp} />}
  bottomNav={<BottomNav lang={lang} userId={userId} />}
>
  <main className="main-content safe-area-top safe-area-bottom bg-[var(--mp-surface-sunken)]">
    {children}
  </main>
</AppLayout>
```

**Props:** `sidebar?`, `bottomNav?`, `children`, `className?`.

**Consuming surfaces:** every page that renders `<div className="app-layout">` (stats, progress, home, settings, quiz, exam, flashcards, curriculum). Migration in B.2.

---

### ContextTabs — `<ContextTabs>`

Tabbed context panel with two visual variants:

- `variant="underline"` (default) — the live Quiz-B underline style from QuestionCard. B.3 migration is zero visual diff.
- `variant="pill"` — wraps `.mp-tabs` pill container. Use for secondary page-level navigation.

**IMPORTANT for B.3:** do NOT assume underline vs pill are interchangeable. The live Quiz-B tabs are underline; applying `variant="pill"` in B.3 is a deliberate visual change that must be approved.

```tsx
type PostAnswerTab = "erklaerung" | "ki" | "notizen" | "uebersetzen" | "quelle"

<ContextTabs
  tabs={[
    { id: "erklaerung", label: "Erklärung", icon: <Lightbulb className="w-3.5 h-3.5" /> },
    { id: "ki", label: "KI-Erklärung", icon: <Bot className="w-3.5 h-3.5" />, isAction: true,
      hint: "KI-Erklärung für jede Frage — kostenlos." },
    { id: "notizen", label: "Notizen", icon: <FileText className="w-3.5 h-3.5" /> },
    { id: "uebersetzen", label: "Übersetzen", icon: <Languages className="w-3.5 h-3.5" /> },
    { id: "quelle", label: "Quelle", icon: <BookOpen className="w-3.5 h-3.5" /> },
  ]}
  activeTab={activeTab}
  onTabChange={(id) => setActiveTab(id as PostAnswerTab)}
  onTabAction={(id) => { if (id === "ki") setShowAIChat(true) }}
  ariaLabel="Zusatzinformationen"
>
  <div>{tabPanelContent}</div>
</ContextTabs>

// Pill variant (page-level sub-nav):
<ContextTabs variant="pill" tabs={sections} activeTab={section} onTabChange={setSection}>
  {panelContent}
</ContextTabs>
```

**Props:** `tabs` (required, array of `ContextTab<TId>`), `activeTab`, `onTabChange`, `onTabAction?`, `variant?` (`"underline"` | `"pill"`, default `"underline"`), `ariaLabel?`, `children?`, `className?`. Generic over `TId extends string`.

**Consuming surfaces:** `src/components/QuestionCard.tsx` Quiz-B tab bar (lines 609–645). B.3 migration replaces the inline tab bar with this primitive.

---

## What's NOT in here yet

Tracked in `design-system/DESIGN-DEBT.md`:

- `<Sparkline>` chart primitive (blocked on chart palette being tokenized)

When you need a new primitive, add it here, follow the pattern from existing ones (forwardRef if appropriate, a11y-first, docstring with usage example), and update this README.

---

## a11 contracts (2026-10-12, UX-GLOBAL-09 to 35)

Frozen contracts so clusters fill disjoint files. Migration onto these happens
inside the PR that already touches a route for a learner-facing fix, one route
per PR with a screenshot diff, never together with a shell rewrite or the exam
clock (UX-GLOBAL-29).

### Dialog placements (UX-GLOBAL-14)

`placement`: `center` (default) · `auto` (bottom sheet under 640 px, centred
above) · `sheet` · `fullscreen` (lightbox). `kind`: `auto` · `content` (focus the
title) · `form` (first field) · `confirm` (focus `[data-dialog-safe]`; the
`[data-dialog-primary]` button stays inert for 800 ms). `busy` blocks Escape,
scrim, close and Back while a write runs; `mandatory` has no close path.
Escape closes only the topmost overlay; Android Back and iOS swipe-back close
it through a pushed history entry; the background is `inert`. The phone
placement is not the rejected desktop BottomSheet (tombstone above).
`window.confirm` is not used anywhere. Non-modal popovers (KebabMenu, the
feedback form) are not Dialogs: no trap, close on Escape/outside tap.

### Status (UX-GLOBAL-15)

`announce(text, 'polite' | 'assertive')` from `@/lib/announce` feeds the two
root live regions (`<LiveRegions />` in the root layout). Visible status text
is plain text; the code that changes it calls `announce()` once. No
per-component `aria-live`. Toasts are keyed, capped at 3, errors stay at
least 10 s, and are spoken through `announce()`; errors also render inline.

### Shell (UX-GLOBAL-09/10/11)

- `AppLayout mode`: `standard` · `focus` (no Sidebar, BottomNav, feedback
  launcher or offline pill mounted) · `public` (no learner chrome).
- `PageHeader`: one row, 22/28 px title, optional subtitle, back IconButton
  using `goBack()` (`returnTo` → in-app history → IA parent → Home or
  /landing), one trailing slot.
- Navigation: `src/lib/nav-destinations.ts` is the one destination list. The
  Sidebar and the Mehr sheet render it; BottomNav shows five items maximum.
- Layers: `--mp-z-{base,sticky,nav,banner,sheet,dialog,lightbox,toast}` and
  `.mp-layer-*`; no literal `z-50`/`z-[60]` in new or touched code.
- Top status region (`shell/StatusRegion`): every banner in one sticky in-flow
  region publishing `--mp-banner-h`; one banner at a time on phones.
- Bottom budget: the nav plus at most one `StickyActionBar`.

### Answers, images, results (UX-GLOBAL-25/26/27)

- `Option` states `idle · selected · correct · wrong · missed · disabled ·
  revealed`; `optionStateFor({ answered, selected, correct })`. One tag
  vocabulary: "Ihre Wahl, richtig" · "Ihre Wahl, falsch" · "Richtig, nicht
  gewählt". No opacity after grading; `static` for review lists.
- `QuestionImage`: reserved aspect-ratio box, Skeleton, retry and "Problem
  melden" with reason "Bild fehlt". `ImageLightbox` is the one lightbox
  (Dialog fullscreen, native pinch/scroll, +/- and reset, arrow keys).
- `ResultCard` + `resultVerdict()`: neutral card, hero number, status chip,
  save chip, one primary action. No pass words; part runs are "Übung".

### Focus, type, targets (UX-GLOBAL-23/24)

Focus is a 2 px solid outline (`--mp-focus-color`), 2 px offset, forced-colors
aware. Text floor 13 px for state and must-read text; inputs 16 px under
768 px; `.mp-hit` gives a 44 px hit area without changing the visual size.
