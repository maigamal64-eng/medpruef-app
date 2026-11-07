# MedPrüf

Exam preparation for foreign-trained doctors going through the Austrian recognition process (Nostrifizierung): the Stichprobentest, SIP4a and SIP5a practice for the Kenntnisprüfung in Vienna, and pharmacology (Rezeptierkunde). It is a web app with a question bank, spaced-repetition drills, exam simulation, a personal study plan and progress tracking. German is the primary interface language, with English and several others available.

This repository is the application source: a Next.js app, its Supabase schema and its test suites.

## Stack

| Area | Choice |
|---|---|
| Framework | Next.js 15 (App Router, route handlers, middleware), React 19 |
| Language | TypeScript, `strict` mode |
| Styling | Tailwind CSS 4, shared design tokens in `design-system/` |
| Data and auth | Supabase (Postgres, row level security, `@supabase/ssr` sessions) |
| Monitoring | Sentry (client, server and edge configs at the repo root) |
| Unit tests | Vitest, Node environment |
| End-to-end tests | Playwright with axe-core accessibility checks |
| Hosting | Vercel (`vercel.json` holds the cron schedule) |

## Repository layout

```
src/app/          routes and route handlers (pages, /api/*, sitemap, llms.txt, openapi.json)
src/components/   shared UI components
src/lib/          domain logic: access rules, billing, exams, study plan, content, i18n, analytics
src/db/           application-side SQL migrations
src/middleware.ts request-level routing, headers and auth redirects
supabase/         migrations and SQL tests for the database
content/          static content: official exam facts, study-plan texts
design-system/    tokens, component CSS and preview kits
i18n-staging/     translation catalogues for the secondary languages
public/           static assets, manifest, offline page
scripts/          build-time checks, importers and maintenance scripts
tests/unit/       Vitest suites, one folder per feature area
tests/e2e/        Playwright specs (responsive sweeps, accessibility, user flows)
docs/adr/         architecture decision records
```

## Running it locally

Requirements: Node.js 20 or newer and a Supabase project (hosted or local).

```bash
npm ci
touch .env.local         # then set the variables below
npm run dev               # http://localhost:3000
```

Minimum environment variables (names only):

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_SITE_URL`

Other integrations (payments, email, error reporting, scheduled jobs) are switched on by further variables such as `CRON_SECRET` and `NEXT_PUBLIC_GA_ID`. Each is read in one place under `src/lib`, and features that depend on an integration stay off when its variables are absent.

Database schema lives in `supabase/migrations`. Apply it to an empty project with the Supabase CLI (`supabase db push`).

## Tests and checks

```bash
npm run typecheck     # tsc --noEmit
npm run lint          # ESLint (next/core-web-vitals)
npm run lint:style    # design token drift guard
npm run lint:copy     # copy and register rules for user-facing text
npm run check:claims  # blocks unsupported public claims (pass rates, guarantees, affiliations)
npm run test:unit     # Vitest
npm run test:e2e      # Playwright; start `npm run dev` first, BASE_URL overrides the target
```

Unit tests mirror the `src/` tree under `tests/unit/`. They cover pure logic only, with no DOM and no network. Browser behaviour, responsive layouts and accessibility (WCAG 2.1 AA via axe-core) are covered by Playwright.

## Architecture notes

- **Access is enforced in the database and the route, not the UI.** Row level security protects learner data, and privileged operations run through named Postgres functions rather than generic table access. `docs/adr/2026-10-05-private-ops-mcp-p0.md` records the least-privilege design for the operations interface: scoped, expiring credentials, a dedicated database role, and durable prepare, approve, execute records for every mutation.
- **Features ship behind flags.** Payments, messaging and new learner-visible behaviour are gated by environment flags (for example `TRIAL_REMINDER_EMAILS_ENABLED`, `STUDY_PLAN_PUBLIC_ENABLED`), so a deploy does not change behaviour by itself.
- **Content is data with provenance.** Official exam facts live in `content/official/` as JSON and feed the pages; `npm run check:claims` and `npm run lint:copy` fail when user-facing text makes a claim the product cannot back.
- **Scheduled work runs as cron route handlers** under `src/app/api/cron/`, declared in `vercel.json` and protected by a shared secret.
- **Installable.** A web manifest and `public/offline.html` provide the install and offline fallback.

## Quality bar

A change is done when the type check, lint, copy and claim guards and the unit suite pass, and the Playwright specs for the touched surface pass. Database changes ship with SQL tests under `supabase/tests/`.
