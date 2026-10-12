# MedPrüf Design System (MPDS)

**Company:** MedPrüf — AI-powered Austrian medical licensing exam prep for foreign doctors.
**Audience:** ~64,000 foreign-trained physicians preparing for the Austrian Kenntnisprüfung (Wien), KMP (Innsbruck), and Pharmakologie (Rezeptierkunde).
**Product:** 10,993 structured questions, spaced-repetition drills, exam simulation, personalized Lernplan, clinical-grade AI explanations in 7 languages (DE primary, EN/RU/AR/FR/TR/UK/SR).

> Austrian, not German. We always say "Österreich / Wien" — never "Deutschland / deutsch" when referring to the exam context.

---

## Sources

- **Codebase** (read-only, mounted): `src/` — Next.js 15 + Tailwind v4 app. Canonical token source is `src/app/globals.css`.
- **Uploaded brand assets:** `uploads/*.png|svg` (logomark, wordmark variants, seal, badge, favicons, OG image).
- **Key reference screens** (in codebase):
  - `src/app/page.tsx` — logged-in home (hero banner, daily goal, streak, topic grid).
  - `src/app/landing/page.tsx` — marketing landing.
  - `src/app/quiz/page.tsx` + `src/components/QuestionCard.tsx` — core daily surface.
  - `src/app/progress/page.tsx`, `src/app/study-plan/page.tsx`, `src/app/pricing/page.tsx`.
  - `src/components/Sidebar.tsx`, `BottomNav.tsx`, `TopicCard.tsx`, `StreakWidget.tsx`, `XPBar.tsx`, `DailyGoalRing.tsx`, `Logo.tsx`.

---

## CONTENT FUNDAMENTALS

**Tone:** calm clinical confidence. Never jokey. Never condescending. Evidence-based, guideline-cited (ERC 2021, ESC, ÖDG, AGES). Think: a senior Austrian attending physician explaining a case to a foreign registrar they respect.

**Voice system:**
- German is **primary**; English is secondary toggle.
- German copy defaults to **Sie-Form (formal)**. `du` ONLY in onboarding greetings and streak celebrations ("Dein 7-Tage-Streak!"). Never mix within a screen.
- English copy is **clinical-professional**, not casual. Avoid "awesome", "crushed it", "level up!".
- Numbers: German uses dot-thousands `10.993`; English uses comma `10,993`.
- Dates: German `17. April 2026`; English `April 17, 2026`.

**Copy examples (lifted from the product):**
- Hero (DE): "Du bist 34% näher am Bestehen 🇦🇹" → the 🇦🇹 flag is the *only* emoji that ships in production copy.
- Hero (EN): "You're 34% closer to passing"
- CTA primary (DE/EN): "Jetzt lernen" / "Start studying" — never "Sign up free!!"
- Pricing headline: "Lerne jetzt. Bezahle, wenn es sich lohnt." / "Study now. Pay when it's worth it."
- Error state: "Antwort war falsch. Hier ist, warum." — calm, not apologetic.
- Streak banner: "Dein 7-Tage-Streak 🔥" (one of two approved emoji: flame for streak, flag for Austria).

**Forbidden phrases:**
- "pass guaranteed" / "Bestehen garantiert" — we say **"prepared for" / "vorbereitet"**.
- "German exam" / "deutsche Prüfung" — always **"Austrian exam" / "österreichische Prüfung"**.
- Clinical recommendations phrased as medical advice to the reader.

**Emoji policy:** essentially none in production UI. The only sanctioned glyphs:
- 🔥 streak flame (appears in StreakWidget, XPBar rank icons).
- 🇦🇹 Austrian flag (hero banner only).
- The branded `ü` dots loader (two animated viridian dots over the logomark — see `BrandedLoader` component).
- Reactions, celebrations, empty states all use **Lucide icons**.

**Vibe in one sentence:** Reassuring precision. The UI should feel like your quietly competent exam-prep partner, not a gamified flashcard arcade — though the XP system exists, it stays in its lane.

---

## VISUAL FOUNDATIONS

**Color vibe:** cool, clinical, high-trust. Oxford Blue (`#001B3D`) anchors surfaces that demand confidence (sidebar, hero banners, headings). Viridian (`#007B5F`) carries correctness, progress, streaks. CTA Blue (`#003A8C`) owns primary actions. Warm tones (`#F4A261` amber, `#D64545` red) appear only for warnings and errors — never decorative.

**Palette at a glance:**
- Primary: Oxford Blue `#001B3D`, Viridian `#007B5F`, CTA Blue `#003A8C`
- Accents: Teal `#00A896`, Warning `#F4A261`, Error `#D64545`, Info `#3A7CA5`
- Neutrals (light): bg `#F7F9FC`, border `#E4E9F0`, text `#1A2B3C`, muted `#4A5568`, light `#A0AEC0`
- Neutrals (dark): bg `#0F172A`, surface `#1E293B`, text `#E2E8F0`, border `#334155`

**Type:**
- Body: **Inter** variable (300/400/500/700/900). 400 body, 500 UI labels, 700 strong, 900 hero numerals only.
- Display: **Plus Jakarta Sans** (600/700/800) via `.font-display`.
- Mono: **JetBrains Mono** via `.font-mono` — streak counters, XP totals, percentages, exam countdowns, tabular numerics.

**Scale:** H1 40/800 display · H2 28/700 display · H3 20/600 display · body 16/400 Inter · small 13 · caption 13 uppercase tracked.

**Spacing:** strict 8-point grid — 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64. Layout max-width 1200px (feels cheap wider); quiz pane narrows to 720px for focused reading.

**Radii:**
- 8px inputs
- 10px small buttons
- 14px cards
- 20px modals
- full for pills and badges

**Elevation — four canonical tiers** (never hand-roll inline `box-shadow`):
1. `shadow-xs` — inputs at rest
2. `shadow-card` — default card
3. `shadow-card-hover` — hover on interactive cards (+ translateY(-2px))
4. `shadow-elevated` / `shadow-modal` — floating menus, modals

**Backgrounds:** almost always flat `#F7F9FC` or white. **Only sanctioned gradient:** the hero banner on the logged-in home — `linear-gradient(to right, #001B3D, #003A8C)` with a barely-visible 3%-opacity radial dot pattern at 24px grid. The `cta-shimmer` class runs a horizontal viridian→teal→viridian shimmer on the primary CTA. No bluish-purple slop gradients anywhere.

**Imagery:** zero stock medical photography (no white-coat-stethoscope clichés). Logomark and abstract iconography only. Icons from Lucide.

**Borders:** 1px `rgba(228, 233, 240, 0.7)` on default cards, tightening to solid `#E4E9F0` on hover. Topic cards use a 3px-wide colored left-edge keyed to the specialty.

**Hover states:**
- Buttons primary: background darkens `#003A8C → #002d6e`. **Dark extension (2026-10-12, UX-GLOBAL-21):** the dark primary is `#4D8DF0` with an `#001B3D` label (5.21:1), hover `#6BA1F4`. Exactly one filled primary per screen state; `success` fills are for confirmations only, never purchase or trial buttons. Destructive is the `--mp-error` fill with `--mp-fg-on-error`.
- Buttons secondary: bg tints to `#F7F9FC`, border darkens `#E4E9F0 → #A0AEC0`.
- Cards: `translateY(-2px)` + elevation bump + border solidifies.

**Press states:** `scale(0.98)` on buttons, `scale(0.99)` on interactive cards. Never change color on press — scale is the signal.

**Transparency + blur:** no fixed layer uses blur any more (2026-10-12, UX-GLOBAL-11/14): the bottom nav is opaque `--mp-surface-raised` with a top border, dialog scrims are solid. `.glass` remains only on legacy marketing surfaces.

**Animation system (all respect `prefers-reduced-motion`, which disables everything listed below):**
- Durations: micro 120ms, base 200ms, hero 350-400ms. Never over 500ms.
- Easings: `cubic-bezier(0.16, 1, 0.3, 1)` (ease-out) for most transitions. `cubic-bezier(0.34, 1.56, 0.64, 1)` (spring) for bookmarks and flashcard flips.
- Named animations: `stagger-in`, `answer-correct` (viridian ring pulse), `answer-wrong` (6-frame horizontal shake), `slide-reveal` (explanation drawer), `scale-in` (modals), `bookmark-bounce`, `flip-card` (600ms 3D rotate), `loader-dot-bounce` (the ü dots), `cta-shimmer` (3s infinite on primary CTA), `xp-pop` (1.2s scale + rise), `fire-pulse` (streak flame 1.5s).

**Layout rules:**
- Desktop: 260px dark Oxford-Blue sidebar (collapses to 68px icon-only, persisted in localStorage `medpruef_sidebar_collapsed`) + main canvas.
- Mobile: bottom nav with five items maximum and a **raised centre action** ([name]'s HOME-49 option B, 12 Oct 2026): Start, Simulation, **Üben (raised, CTA blue)**, Lernplan (the mentor takes this slot when it is switched on for the learner), Mehr. The Mehr sheet and the desktop Sidebar render one destination list in the same groups (Lernen, Planen, Auswerten, Konto); source `src/lib/nav-destinations.ts`.
- Max content width 1200px. Quiz reading pane 720px.
- Sidebar auto-hides on `/quiz` and `/exam` for distraction-free testing.
- Pinch-zoom is **never** disabled (WCAG 2.1 1.4.4, enforced 2026-04-15 post-audit).

**Accessibility non-negotiables:**
- Every interactive element has a visible focus indicator: a 2px solid outline, 2px offset, `#003A8C` light / `#6BA1F4` dark, `Highlight` in forced-colors mode (replaces the 2.98:1 teal ring, 2026-10-12).
- `prefers-reduced-motion` disables every animation listed above.
- Touch targets ≥ 44×44 px on the primary path (shared `.mp-hit` utility), 48 px for primary CTAs and plan buttons; the WCAG 2.5.8 24 px floor applies elsewhere.
- Text floor 13 px for anything a learner must read to act; inputs 16 px under 768 px (scoped deviation DD-21).
- Color-only information is forbidden — always pair a color cue with a Lucide icon or a label.
- Arabic renders with `dir="rtl"`.

---

## ICONOGRAPHY

**Library:** **Lucide React** — the entire app uses Lucide and nothing else. Do not mix in Heroicons, Phosphor, Material Symbols, or hand-rolled SVGs. Available via CDN:
```html
<script src="https://unpkg.com/lucide@latest/dist/umd/lucide.js"></script>
```

**Sizes:** 16 / 20 / 24 / 32 px. Default stroke 2. Inline with body text at `1em` line-height.

**Topic / specialty mapping** (from `src/components/TopicIcon.tsx` — preserve this):
- Surgery → `Scissors`
- Cardiology / Internal medicine → `HeartPulse`
- Neurology / Psychiatry → `Brain`
- Ophthalmology → `Eye`
- ENT → `Ear`
- Pediatrics / Gynecology → `Baby`
- Social medicine / Public health → `Users`
- Genetics / Biochemistry → `Dna`
- Communication / Patient interview → `MessageCircle`
- Emergency medicine → `Zap`
- Fallback (unknown topic) → `ClipboardList`

**Common UI icons in use:** `Home`, `FileText`, `GraduationCap`, `BarChart3`, `TrendingUp`, `Map`, `Settings`, `Sparkles`, `PanelLeftClose`, `PanelLeftOpen`, `Layers`, `Crown`, `CalendarDays`, `Flame`, `Lightbulb`, `Check`, `CheckCircle2`, `X`, `Search`, `AlertTriangle`, `Star`, `Bot`, `Flag`, `Highlighter`, `ThumbsUp`, `ThumbsDown`, `ArrowLeft`.

**Logo assets** (in `assets/`):
- `logomark.svg` — U-shape stethoscope mark with two animated viridian dots (the ü-umlaut). Use on dark sidebars with `filter: brightness(0) invert(1)`.
- `wordmark.svg` — "MedPrüf" type. In-product it renders as `<span>Med</span><span class="text-accent">Prüf</span>` (Prüf in viridian/teal).
- `wordmark-mono.png`, `wordmark-twotone.png` — press and app-store variants.
- `logo-full.png` — logomark + wordmark horizontal lockup.
- `seal.png`, `badge.png` — decorative trust seals (used sparingly in landing footer).
- `og-image.png`, `apple-touch-icon.png`, `favicon-64.png`, `icon-512.png` — platform glyphs.

**Unicode / emoji:** only 🔥 (streak) and 🇦🇹 (Austrian flag) ship in production copy. Nothing else.

---

## INDEX — what's in this design system

```
README.md                  ← you are here
SKILL.md                   ← machine-readable skill definition
colors_and_type.css        ← canonical CSS variables + type classes
assets/                    ← logos, wordmarks, seals, OG image, app icons
preview/                   ← small HTML cards rendered in the Design System tab
ui_kits/
  web_app/                 ← in-product UI (sidebar, home, quiz, question card, progress)
  landing/                 ← marketing landing, pricing
```

Prefer reading `colors_and_type.css` first if you're building something quickly — it mirrors the canonical tokens from `src/app/globals.css`.

---

## CAVEATS

- **Font files:** Inter, Plus Jakarta Sans, JetBrains Mono are loaded from Google Fonts CDN rather than self-hosted TTFs (the codebase uses `next/font/google`). If you need offline-bundled TTFs, flag it.
- **Recent design debt (upstream):** `admin/page.tsx` (2000+ LOC) and `QuestionCard.tsx` (800+ LOC) are pre-split monoliths. Patterns extracted from admin may reflect legacy decisions — validate against landing / quiz / progress / study-plan before promoting them.
