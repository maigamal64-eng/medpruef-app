import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { LIGHT, DARK } from './css-tokens'
import { translationKeyExists } from './i18n-keys'

/**
 * Style lints scoped to the trees this package touched (UX-GLOBAL-22/24/29):
 * unrelated debt elsewhere does not block CI.
 */
const TOUCHED = [
  'src/components/ui/Dialog.tsx',
  'src/components/ui/Toast.tsx',
  'src/components/ui/Option.tsx',
  'src/components/ui/AppLayout.tsx',
  'src/components/ui/PageHeader.tsx',
  'src/components/ui/LiveRegions.tsx',
  'src/components/ui/QuestionImage.tsx',
  'src/components/ui/ResultCard.tsx',
  'src/components/ui/StickyActionBar.tsx',
  'src/components/ui/NavItem.tsx',
  'src/components/BottomNav.tsx',
  'src/components/nav/MoreSheet.tsx',
  'src/components/nav/DestinationIcon.tsx',
  'src/components/FeedbackWidget.tsx',
  'src/components/OfflineIndicator.tsx',
  'src/components/ImageLightbox.tsx',
  'src/components/CookieBanner.tsx',
  'src/components/shell/StatusRegion.tsx',
]

const read = (f: string) => readFileSync(f, 'utf8')

describe('touched-tree lints', () => {
  it('no literal z-50 / z-[60] / z-[70] / z-[80] / z-[100] layers', () => {
    for (const file of TOUCHED) {
      expect(read(file), file).not.toMatch(/\bz-(?:50|40|\[(?:60|70|80|100|9999)\])\b/)
    }
  })

  it('no undeclared var(--mp-*) tokens', () => {
    const declared = new Set([...LIGHT.keys(), ...DARK.keys(), '--mp-dialog-depth', '--mp-banner-h', '--mp-cookie-h', '--mp-sticky-action-h', '--mp-bottom-nav-h', '--mp-font-display', '--mp-font-body', '--mp-font-mono', '--mp-sidebar-fg-active', '--mp-sidebar-fg-muted'])
    for (const file of TOUCHED) {
      for (const m of read(file).matchAll(/var\((--mp-[\w-]+)/g)) {
        expect(declared.has(m[1]), `${file}: ${m[1]}`).toBe(true)
      }
    }
  })

  it('no text below the 12px floor and no backdrop blur in the touched primitives', () => {
    for (const file of TOUCHED) {
      const src = read(file)
      expect(src, file).not.toMatch(/text-\[(?:8|9|10|11)px\]/)
      expect(src, file).not.toMatch(/backdrop-blur|backdrop-filter/)
    }
  })

  it('no opacity used to dim answer text after grading', () => {
    expect(read('src/components/ui/Option.tsx')).not.toMatch(/opacity-50|opacity-40/)
  })

  it('every literal t("…") key used by the touched files exists', () => {
    for (const file of TOUCHED) {
      for (const m of read(file).matchAll(/\bt\(\s*['"]([\w-]+)['"]/g)) {
        expect(translationKeyExists(m[1]), `${file}: ${m[1]}`).toBe(true)
      }
    }
  })

  it('window.confirm is not used by the shared primitives', () => {
    for (const file of TOUCHED) expect(read(file), file).not.toMatch(/window\.confirm\(/)
  })
})
