import { readFileSync } from 'node:fs'

const SOURCE = readFileSync('src/lib/i18n.ts', 'utf8')

/** True when the base translation map declares this key with de and en. */
export function translationKeyExists(key: string): boolean {
  const re = new RegExp(`(?:^|\\n)\\s*['"]?${key.replace(/[-]/g, '\\-')}['"]?\\s*:\\s*\\{\\s*["']?de["']?\\s*:`)
  return re.test(SOURCE)
}

/** The German string of a base key (for register checks). */
export function germanOf(key: string): string | null {
  const re = new RegExp(`(?:^|\\n)\\s*['"]?${key}['"]?\\s*:\\s*\\{\\s*["']?de["']?\\s*:\\s*["']([^"']*)["']`)
  return SOURCE.match(re)?.[1] ?? null
}
