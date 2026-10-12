#!/usr/bin/env node
/**
 * check-style-drift.mjs -- MPDS style-drift CI guard (B.5, 2026-06-26)
 *
 * Scans src/ for two categories of new style drift:
 *   1. Raw hex literals in Tailwind arbitrary-value className strings:
 *      bg-[#...], text-[#...], border-[#...]
 *      These should be var(--mp-*) tokens.
 *   2. Inline style={{ }} blocks injecting color via quoted "#..." hex literals.
 *      These should be var(--mp-*) tokens.
 *
 * HOW IT WORKS:
 *   Known intentional hex usages (brand colors without MPDS tokens,
 *   third-party service colors) are recorded in BASELINE below, keyed by a
 *   "file-fragment|literal" pair. Any scan match not in the baseline exits 1.
 *   This makes the guard green on the current tree and red on new drift.
 *
 * EXCLUDED PATHS (not scanned):
 *   - opengraph-image.tsx  (OG card generation, raw hex intentional)
 *   - checkout/success/    (separate payment-success design, out of MPDS scope)
 *
 * ADDING A NEW INTENTIONAL HEX:
 *   If a new brand color or third-party color has no MPDS token equivalent,
 *   add a BASELINE entry: '<file-path-fragment>|<matched-literal>'
 *   where file-path-fragment is a substring of the relative path
 *   (e.g. 'admin/users|bg-[#229ED9]') and explain WHY in a comment.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

// == Excluded path patterns ==
const EXCLUDED_PATTERNS = [
  /opengraph-image\.tsx$/,
  /checkout\/success/,
]

// == Known approved hex literals ==
// Each entry is a pipe-separated tuple: "<file-path-fragment>|<matched-literal>"
// A match is approved if the file path contains the fragment AND the literal
// appears on that line.
const BASELINE = new Set([
  // app/page.tsx -- XP hover tint (#FFD080, no mp-gamif-xp hover token yet)
  'app/page.tsx|text-[#FFD080]',

  // app/page.tsx -- Telegram brand blue (external brand, no MPDS token)
  'app/page.tsx|bg-[#229ED9]',
  'app/page.tsx|bg-[#1e8fc0]',

  // admin/users -- Telegram badge (external brand color)
  'admin/users|bg-[#229ED9]',
  'admin/users|text-[#229ED9]',


  // exam/page -- flagged-question minimap dark text on warning bg
  // (#1A0E00 = near-black on amber; no mp-fg-on-warning token yet)
  'app/exam|text-[#1A0E00]',

  // QuestionCard -- amber warning hover + dark text on warning
  // (#FFC97A = amber hover on warning state; #1A0E00 = near-black on amber)
  'QuestionCard|bg-[#FFC97A]',
  'QuestionCard|text-[#1A0E00]',

  // WhatsNewModal -- Clarity purple + warning-dark for feature icons
  // (#8B5CF6 no token, #D68A3A = mp-warning-dk used in className context)
  'WhatsNewModal|text-[#8B5CF6]',
  'WhatsNewModal|text-[#D68A3A]',

  // Sidebar -- oxford-blue dark chip (no MPDS token for this shade)
  'Sidebar|bg-[#002952]',
])

// == File walker ==
const SRC_DIR = new URL('../src', import.meta.url).pathname
const failures = []

function* walkTsx(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      yield* walkTsx(full)
    } else if (/\.(tsx|jsx)$/.test(entry)) {
      const rel = relative(SRC_DIR, full)
      if (!EXCLUDED_PATTERNS.some((p) => p.test(rel))) {
        yield { full, rel }
      }
    }
  }
}

// Pattern 1: hex in Tailwind arbitrary-value className
// Matches: bg-[#xxxx], text-[#xxxx], border-[#xxxx]
// Does NOT match: bg-[var(...,#xxxx)] because bracket immediately precedes #
const HEX_CLASS_RE = /\b(?:bg|text|border)-\[#[0-9A-Fa-f]{3,8}(?:\/\d+)?\]/g

// Pattern 2: inline style color with quoted hex literal
// Matches: color: "#...", backgroundColor: "#...", background: "#...", borderColor: "#..."
// Does NOT match: var(...), template literals, named colors like "white"
const HEX_STYLE_RE = /(?:color|backgroundColor|background|borderColor)\s*:\s*["']#[0-9A-Fa-f]{3,8}["']/g

// == Scan ==
for (const { full, rel } of walkTsx(SRC_DIR)) {
  const src = readFileSync(full, 'utf8')
  const lines = src.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNum = i + 1

    // Check hex-in-className
    for (const match of line.matchAll(HEX_CLASS_RE)) {
      const literal = match[0]
      const approved = [...BASELINE].some((entry) => {
        const [fragment, lit] = entry.split('|')
        return rel.includes(fragment) && literal === lit
      })
      if (!approved) {
        failures.push(`[hex-class]  ${rel}:${lineNum}  ->  ${literal}`)
      }
    }

    // Check inline style color hex
    for (const match of line.matchAll(HEX_STYLE_RE)) {
      const literal = match[0]
      const approved = [...BASELINE].some((entry) => {
        const [fragment, lit] = entry.split('|')
        return rel.includes(fragment) && line.includes(lit)
      })
      if (!approved) {
        failures.push(`[hex-style]  ${rel}:${lineNum}  ->  ${literal.trim()}`)
      }
    }
  }
}

// == Result ==
if (failures.length === 0) {
  console.log('check-style-drift: no new hex-color drift detected')
  process.exit(0)
} else {
  console.error('check-style-drift: hex-color drift detected -- replace with var(--mp-*) tokens\n')
  for (const f of failures) {
    console.error('  ' + f)
  }
  console.error(`\n  ${failures.length} violation(s). Fix before merging.`)
  console.error('  To baseline an intentional case, add a BASELINE entry in scripts/check-style-drift.mjs.')
  process.exit(1)
}
