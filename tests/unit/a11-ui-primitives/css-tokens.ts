import { readFileSync } from 'node:fs'

/** Minimal token reader for globals.css: last declaration per scope wins. */
export const CSS = readFileSync('src/app/globals.css', 'utf8')

function blocks(selector: RegExp): string[] {
  const out: string[] = []
  const re = new RegExp(selector.source + '\\s*\\{', 'g')
  while (re.exec(CSS)) {
    let depth = 1
    let i = re.lastIndex
    const start = i
    while (i < CSS.length && depth > 0) {
      if (CSS[i] === '{') depth++
      else if (CSS[i] === '}') depth--
      i++
    }
    out.push(CSS.slice(start, i - 1))
  }
  return out
}

function declarations(scope: 'light' | 'dark'): Map<string, string> {
  const map = new Map<string, string>()
  const list = scope === 'light' ? blocks(/(?:^|\n):root/) : blocks(/(?:^|\n)\[data-theme="dark"\]/)
  for (const body of list) {
    for (const m of body.matchAll(/(--mp-[\w-]+)\s*:\s*([^;]+);/g)) map.set(m[1], m[2].replace(/\/\*.*?\*\//g, '').trim())
  }
  return map
}

export const LIGHT = declarations('light')
export const DARK = declarations('dark')

/** Resolve a token to a hex, following var() aliases (dark falls back to light). */
export function resolve(name: string, theme: 'light' | 'dark', depth = 0): string {
  if (depth > 10) throw new Error(`alias loop at ${name}`)
  const value = (theme === 'dark' ? DARK.get(name) ?? LIGHT.get(name) : LIGHT.get(name))
  if (!value) throw new Error(`undeclared token ${name} (${theme})`)
  const alias = value.match(/^var\((--mp-[\w-]+)(?:,[^)]*)?\)$/)
  if (alias) return resolve(alias[1], theme, depth + 1)
  return value
}

export function luminance(hex: string): number {
  const h = hex.replace('#', '')
  const rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2])
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}
