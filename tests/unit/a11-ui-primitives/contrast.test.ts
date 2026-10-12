import { describe, expect, it } from 'vitest'
import { CSS, DARK, LIGHT, contrast, resolve } from './css-tokens'

/**
 * UX-GLOBAL-21/22/23: the published contrast table. Every pair is measured
 * on its real backgrounds in both themes (white card, sunken well, own tint;
 * dark card #11233E and dark canvas #081224).
 */

const LIGHT_BG = { white: '#FFFFFF', sunken: '#EDF1F7', errorTint: '#FDECEC', warningTint: '#FFF4E6', infoTint: '#EAF3F9', successTint: '#E6F4F1' }
const DARK_BG = { card: '#11233E', canvas: '#081224' }

describe('state text tokens (UX-GLOBAL-22)', () => {
  it('light error is #B03030 and dark error #F26D6D', () => {
    expect(resolve('--mp-error', 'light')).toBe('#B03030')
    expect(resolve('--mp-error', 'dark')).toBe('#F26D6D')
  })

  it('--mp-error-text resolves to --mp-error, never an independent hex', () => {
    expect(LIGHT.get('--mp-error-text')).toBe('var(--mp-error)')
    expect(DARK.get('--mp-error-text') ?? 'var(--mp-error)').toBe('var(--mp-error)')
    expect(CSS).not.toMatch(/--mp-error-text:\s*#/)
  })

  it('text tokens reach 4.5:1 on white, sunken and their own tints (light)', () => {
    const table: Array<[string, string[]]> = [
      ['--mp-error-text', [LIGHT_BG.white, LIGHT_BG.sunken, LIGHT_BG.errorTint]],
      ['--mp-warning-text', [LIGHT_BG.white, LIGHT_BG.sunken, LIGHT_BG.warningTint]],
      ['--mp-info-text', [LIGHT_BG.white, LIGHT_BG.infoTint]],
      ['--mp-success-text', [LIGHT_BG.white, LIGHT_BG.successTint]],
      ['--mp-fg', [LIGHT_BG.white, LIGHT_BG.sunken]],
      ['--mp-fg-muted', [LIGHT_BG.white, LIGHT_BG.sunken]],
    ]
    for (const [token, bgs] of table) {
      for (const bg of bgs) expect(contrast(resolve(token, 'light'), bg), `${token} on ${bg}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('text tokens reach 4.5:1 on the dark card and canvas', () => {
    for (const token of ['--mp-error-text', '--mp-warning-text', '--mp-info-text', '--mp-success-text', '--mp-fg', '--mp-fg-muted', '--mp-fg-subtle']) {
      for (const bg of Object.values(DARK_BG)) expect(contrast(resolve(token, 'dark'), bg), `${token} on ${bg}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('#D68A3A stays a fill/icon token and is documented as not text-safe', () => {
    expect(contrast(resolve('--mp-warning-dk', 'light'), '#FFFFFF')).toBeLessThan(3)
    expect(CSS).not.toMatch(/WCAG AA-safe on white/)
  })

  it('sole-indicator control borders reach 3:1 in both themes', () => {
    expect(contrast(resolve('--mp-border-control', 'light'), LIGHT_BG.white)).toBeGreaterThanOrEqual(3)
    expect(contrast(resolve('--mp-border-control', 'dark'), DARK_BG.card)).toBeGreaterThanOrEqual(3)
  })
})

describe('primary and destructive actions (UX-GLOBAL-21, ADM-Q23)', () => {
  it('primary is CTA blue with a white label in light, #4D8DF0 with #001B3D in dark', () => {
    expect(resolve('--mp-action-primary', 'light')).toBe('#003A8C')
    expect(resolve('--mp-fg-on-cta-blue', 'light')).toBe('#FFFFFF')
    expect(resolve('--mp-action-primary', 'dark')).toBe('#4D8DF0')
    expect(resolve('--mp-fg-on-cta-blue', 'dark')).toBe('#001B3D')
    expect(contrast('#003A8C', '#FFFFFF')).toBeGreaterThanOrEqual(4.5)
    expect(contrast('#4D8DF0', '#001B3D')).toBeGreaterThanOrEqual(4.5)
  })

  it('the dark primary fill is visible on the dark card (3:1, the admin Approve button)', () => {
    expect(contrast(resolve('--mp-action-primary', 'dark'), DARK_BG.card)).toBeGreaterThanOrEqual(3)
  })

  it('.mp-btn--primary rests on the action token and darkens on hover', () => {
    expect(CSS).toMatch(/\.mp-btn--primary \{\s*background: var\(--mp-action-primary\); color: var\(--mp-fg-on-cta-blue\);/)
    expect(CSS).toMatch(/\.mp-btn--primary:hover \{ background: var\(--mp-action-primary-hover\); \}/)
    expect(CSS).not.toMatch(/\.mp-btn--primary \{\s*background: var\(--mp-oxford-blue\)/)
  })

  it('destructive fill labels reach 4.5:1 in both themes', () => {
    expect(contrast(resolve('--mp-fg-on-error', 'light'), resolve('--mp-error', 'light'))).toBeGreaterThanOrEqual(4.5)
    expect(contrast(resolve('--mp-fg-on-error', 'dark'), resolve('--mp-error', 'dark'))).toBeGreaterThanOrEqual(4.5)
  })
})

describe('focus indicator (UX-GLOBAL-23)', () => {
  it('ring colour is #003A8C light and #6BA1F4 dark, 3:1 on every surface', () => {
    expect(resolve('--mp-focus-color', 'light')).toBe('#003A8C')
    expect(resolve('--mp-focus-color', 'dark')).toBe('#6BA1F4')
    expect(contrast('#003A8C', '#EDF1F7')).toBeGreaterThanOrEqual(3)
    for (const bg of Object.values(DARK_BG)) expect(contrast('#6BA1F4', bg)).toBeGreaterThanOrEqual(3)
  })

  it('a 2px solid outline with 2px offset is defined globally, with forced-colors support', () => {
    expect(CSS).toMatch(/:focus-visible \{\s*outline: 2px solid var\(--mp-focus-color\);\s*outline-offset: 2px;/)
    expect(CSS).toMatch(/@media \(forced-colors: active\)/)
    expect(CSS).not.toMatch(/--mp-focus-ring:\s*0 0 0 3px rgba\(0, 168, 150/)
  })
})

describe('layers and motion (UX-GLOBAL-11, 35)', () => {
  it('declares the named z scale in order', () => {
    const order = ['base', 'sticky', 'nav', 'banner', 'sheet', 'dialog', 'lightbox', 'toast'].map((n) => Number(LIGHT.get(`--mp-z-${n}`)))
    expect(order.every((v) => Number.isFinite(v))).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('reduced motion collapses transitions and turns the flip into a crossfade', () => {
    const block = CSS.slice(CSS.indexOf('@media (prefers-reduced-motion: reduce) {'))
    expect(block).toMatch(/transition-duration: 0\.01ms !important/)
    expect(block).toMatch(/scroll-behavior: auto !important/)
    expect(block).toMatch(/\.flip-card-inner, \.flip-card-inner\.flipped \{ transform: none !important; \}/)
  })

  it('inputs are 16px under 768px (no iOS focus zoom)', () => {
    expect(CSS).toMatch(/@media \(max-width: 767px\) \{\s*input:not\(\[type="checkbox"\]\)[^{]+\{ font-size: 16px !important; \}/)
  })
})
