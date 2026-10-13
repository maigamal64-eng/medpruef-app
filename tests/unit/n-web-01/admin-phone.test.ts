import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// n-web-01: web admin phone fixes are layout only. These checks pin the
// responsive classes in source so a later edit cannot quietly undo them.
const root = process.cwd();
const src = (p: string) => readFileSync(join(root, p), "utf8");

const overview = src("src/app/admin/overview/page.tsx");
const signals = src("src/app/admin/overview/MoreSignals.tsx");
const payments = src("src/app/admin/payments/page.tsx");
const users = src("src/app/admin/users/page.tsx");
const questions = src("src/app/admin/questions/page.tsx");
const suggestion = src("src/app/admin/_components/EditSuggestionReview.tsx");
const noteReports = src("src/app/admin/note-reports/page.tsx");
const primitives = src("src/app/admin/_components/primitives.tsx");
const growth = src("src/app/admin/growth/page.tsx");
const css = src("src/app/globals.css");

describe("n-web-01 Overview", () => {
  it("money strip is two columns under 400px and three from 400px", () => {
    expect(overview).toContain('className="grid grid-cols-2 gap-2 min-[400px]:grid-cols-3 sm:gap-3"');
    expect(overview).not.toContain('className="grid grid-cols-3 gap-2 sm:gap-3"');
    // the third cell takes the whole second row on a narrow phone
    expect(overview).toContain('"max-[399px]:col-span-2"');
  });

  it("a failed money cell is not a link, so Retry does not navigate", () => {
    expect(overview).toMatch(/return failed \? \(\s*<div key=\{c\.key\} className=\{className\}>\{body\}<\/div>/);
  });

  it("every Retry button is at least 44px tall", () => {
    const retries = [...overview.matchAll(/<button[^\n]*>Retry<\/button>/g), ...signals.matchAll(/<button[^\n]*>Retry<\/button>/g)].map((m) => m[0]);
    expect(retries.length).toBeGreaterThanOrEqual(2);
    for (const b of retries) expect(b).toContain("min-h-11");
  });
});

describe("n-web-01 Payments", () => {
  it("money table and events feed use ResponsiveTable (cards below 1024px)", () => {
    expect(payments).toContain('import { ResponsiveTable } from "../_components/ResponsiveTable";');
    expect(payments).toMatch(/<ResponsiveTable[\s\S]*?testId="payments-money-table"[\s\S]*?minWidth=\{560\}/);
    expect(payments).toMatch(/<ResponsiveTable[\s\S]*?testId="payments-feed-table"[\s\S]*?minWidth=\{640\}/);
    expect(payments).not.toContain("min-w-[560px]");
    expect(payments).not.toContain("min-w-[640px]");
    expect(payments).not.toContain("<table");
  });

  it("ResponsiveTable switches to cards below 1024px", () => {
    expect(src("src/app/admin/_components/ResponsiveTable.tsx")).toContain('const DESKTOP_QUERY = "(min-width: 1024px)";');
  });
});

describe("n-web-01 Users", () => {
  it("filter chips live in a Filters sheet below sm with an active-filter count", () => {
    expect(users).toMatch(/<div className="shrink-0 sm:hidden">\s*<button[\s\S]*?data-testid="users-filters-button"/);
    expect(users).toContain('<div className="mt-2 hidden sm:block">{filterControls}</div>');
    expect(users).toMatch(/<Dialog[\s\S]*?open=\{filtersOpen\}[\s\S]*?placement="sheet"[\s\S]*?\{filterControls\}/);
    expect(users).toContain("const activeFilterCount =");
    expect(users).toContain('data-testid="users-filters-count"');
  });

  it("the Filters button and the sheet's close button are 44px targets", () => {
    expect(users).toContain('className="mp-btn mp-btn--secondary mp-btn--sm admin-tap"');
    expect(users).toContain('className="mp-btn mp-btn--primary mp-btn--sm admin-tap w-full"');
  });
});

describe("n-web-01 Questions", () => {
  it("phones get Prev, 'Page x of y', Next; numbered pills from sm", () => {
    expect(questions).toMatch(/sm:hidden" data-testid="questions-page-of"[^>]*>\s*Page \{page\} of \{totalPages\}/);
    expect(questions).toContain('<span className="hidden sm:contents">');
    expect((questions.match(/mp-btn--sm admin-tap disabled:opacity-40/g) ?? []).length).toBe(2);
  });

  it("question report dialog footer buttons are at least 44px", () => {
    const footers = [...suggestion.matchAll(/<DialogFooter>([\s\S]*?)<\/DialogFooter>/g)].map((m) => m[1]);
    expect(footers.length).toBe(2);
    for (const f of footers) {
      const classes = [...f.matchAll(/className="([^"]*)"/g)].map((m) => m[1]);
      expect(classes.length).toBeGreaterThan(0);
      for (const c of classes) expect(c).toContain("min-h-11");
    }
  });
});

describe("n-web-01 Note reports", () => {
  it("takedown and dismiss buttons and the confirm footer are min-h-11", () => {
    expect(noteReports).toContain('className="inline-flex min-h-11 items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold border border-[var(--mp-error)]');
    expect(noteReports).toContain('className="inline-flex min-h-11 items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold border border-[var(--mp-border)]');
    expect(noteReports).toContain('className="mp-btn mp-btn--secondary min-h-11" disabled={!!acting}');
    expect(noteReports).toContain('className="mp-btn mp-btn--destructive min-h-11" disabled={!!acting}');
  });
});

describe("n-web-01 coarse-pointer 44px rule", () => {
  const coarse = css.slice(css.indexOf("/* Admin touch targets (a18"), css.indexOf(".admin-card-actions > * {"));
  it("FilterChip and the growth window chips carry admin-chip, which is 44px on touch screens", () => {
    expect(primitives).toMatch(/className=\{`admin-chip inline-flex/);
    expect(growth).toMatch(/className=\{`admin-chip min-h-\[36px\]/);
    expect(coarse).toMatch(/@media \(pointer: coarse\) \{[\s\S]*\.admin-chip \{ min-height: 44px; \}/);
  });

  it("admin text inputs and selects are 44px on touch screens", () => {
    expect(coarse).toContain('[data-admin="1"] input:not([type="checkbox"]):not([type="radio"])');
    expect(coarse).toContain('[data-admin="1"] select { min-height: 44px; }');
  });

  it("admin-tap beats the unlayered .mp-btn--sm floor and comes after it", () => {
    const tap = css.indexOf(".admin-tap, .mp-btn.admin-tap { min-height: 44px; }");
    expect(tap).toBeGreaterThan(-1);
    expect(tap).toBeGreaterThan(css.indexOf(".mp-btn--sm { min-height: 36px; }"));
  });
});
