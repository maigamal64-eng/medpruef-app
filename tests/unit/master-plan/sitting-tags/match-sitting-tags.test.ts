import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCRIPT = join(process.cwd(), 'scripts/content/sitting-tags/match-sitting-tags.py')

const STEM_A = 'Ein 60-jaehriger Patient mit hochgradig eingeschraenkter Linksventrikelfunktion wird ueberwiesen. Welche Medikamentengruppen verbessern das Langzeitueberleben'
const STEM_B = 'Welche Untersuchung ist bei Verdacht auf eine Lungenembolie als erste bildgebende Methode am besten geeignet und wird zuerst durchgefuehrt'
const STEM_C = 'Eine 43-jaehrige Patientin kommt wegen Doppelbildern und einer wechselnden Schwaeche der Arme in Ihre Ordination und nimmt Pyridostigmin ein'
const STEM_D = 'Welcher Wirkstoff gehoert zur Gruppe der Protonenpumpenhemmer und wird bei Refluxkrankheit als Standardtherapie eingesetzt'
const STEM_E = 'Welche Aussage zur Haemophilie A ist richtig und welche Therapie wird bei Blutungen eingesetzt in der Akutsituation'

function bankRow(id: number, question: string, extra: Record<string, unknown> = {}) {
  return { id, question, exam_type: 'kenntnispruefung', is_active: true, exam_dates: ['2023'], source_file: 'SIP_Anki', anki_note_id: null, content_hash: null, ...extra }
}
function note(id: string, noteId: number | null, question: string, tags: string) {
  return { id, kind: 'anki-note', question, tags, examDatesFromSource: [], locators: noteId ? [{ noteId }] : [] }
}

let dir: string
let out: string
type Pair = { note_id: number | null; bank_id: number; match_kind: string; status: string; eligible: boolean; ineligible_reasons: string[]; months: string[]; months_to_append: string[]; bank_exam_dates_before: string[] }
type MonthSummary = { notes_matched: number; notes_unmatched: number; eligible_exact: number; eligible_fuzzy_unverified: number; append_if_exact_only: number; append_if_fuzzy_confirmed: number }
let result: { summary: { months: Record<string, MonthSummary>; notes_total: number; label: string }; pairs: Pair[] }
let review: { bank_id: number; visite_decision: unknown }[]

function run(extra: string[] = []) {
  const r = spawnSync('python3', [SCRIPT, '--data-dir', dir, '--out', out, ...extra], { encoding: 'utf8' })
  expect(r.status, r.stderr).toBe(0)
  result = JSON.parse(readFileSync(join(out, 'matched-pairs.json'), 'utf8'))
  review = JSON.parse(readFileSync(join(out, 'fuzzy-review.json'), 'utf8'))
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'b32-'))
  out = join(dir, 'out')
  const bank = [
    bankRow(1, STEM_A, { anki_note_id: 111 }),
    bankRow(2, STEM_B),
    bankRow(3, STEM_C + ' wegen Myasthenie'),
    bankRow(4, STEM_D, { exam_type: 'kmp_innsbruck' }),
    bankRow(5, STEM_E, { is_active: false }),
    bankRow(6, STEM_A + ' beta blocker', { exam_dates: ['2025-06'], anki_note_id: 222 }),
  ]
  const archive = [
    note('a1', 111, 'completely different text that does not matter for note id matching here', '2025-06 SPT25'),
    note('a2', 333, STEM_B.toUpperCase(), '2025-09'),
    note('a3', 444, STEM_C, '2025-06 2025-11'),
    note('a4', 555, STEM_D, '2025-11'),
    note('a5', 666, STEM_E, '2025-06'),
    note('a6', 222, 'x', '2025-06'),
    note('a7', 777, 'Frage ohne jeden Treffer in der Bank zu einem voellig anderen Thema der Chirurgie und Anaesthesie', '2025-06'),
    note('a8', 888, STEM_B, '2024-06 2019-03'),
    { id: 'p1', kind: 'pdf-page', text: STEM_B, tags: '2025-06', examDatesFromSource: [], locators: [] },
    note('a9', 111, 'second deck copy of the same note', '2025-09'),
  ]
  writeFileSync(join(dir, 'ourbank.jsonl'), bank.map((b) => JSON.stringify(b)).join('\n') + '\n')
  writeFileSync(join(dir, 'archive-questions.jsonl'), archive.map((b) => JSON.stringify(b)).join('\n') + '\n')
  run()
})

afterAll(() => rmSync(dir, { recursive: true, force: true }))

const pair = (noteId: number) => result.pairs.find((p) => p.note_id === noteId)

describe('match-sitting-tags.py', () => {
  it('matches by anki note id and merges the same note across decks', () => {
    const p = pair(111)!
    expect(p.bank_id).toBe(1)
    expect(p.match_kind).toBe('anki_note_id')
    expect(p.months).toEqual(['2025-06', '2025-09'])
    expect(p.status).toBe('confirmed-exact')
  })

  it('matches by normalised stem hash (case and umlaut insensitive)', () => {
    const p = pair(333)!
    expect(p.bank_id).toBe(2)
    expect(p.match_kind).toBe('hash')
    expect(p.months_to_append).toEqual(['2025-09'])
  })

  it('keeps fuzzy matches unconfirmed and lists them for the human check', () => {
    const p = pair(444)!
    expect(p.bank_id).toBe(3)
    expect(p.match_kind).toBe('fuzzy')
    expect(p.status).toBe('needs-visite-check')
    expect(review.map((r) => r.bank_id)).toEqual([3])
    expect(review[0].visite_decision).toBeNull()
  })

  it('flags inactive and non-Vienna bank rows as ineligible', () => {
    expect(pair(555)!.eligible).toBe(false)
    expect(pair(555)!.ineligible_reasons).toEqual(['exam_type is kmp_innsbruck'])
    expect(pair(666)!.ineligible_reasons).toEqual(['bank row inactive'])
  })

  it('appends only months the bank row does not carry yet', () => {
    const p = pair(222)!
    expect(p.bank_id).toBe(6)
    expect(p.months_to_append).toEqual([])
    expect(p.bank_exam_dates_before).toEqual(['2025-06'])
  })

  it('counts unmatched notes and ignores notes outside the target sittings and pdf pages', () => {
    expect(result.summary.months['2025-06'].notes_unmatched).toBe(1)
    expect(result.pairs.find((p) => p.note_id === 888)).toBeUndefined()
    expect(result.summary.notes_total).toBe(7)
    expect(result.summary.months['2026-04'].notes_matched).toBe(0)
  })

  it('summary separates exact from unverified fuzzy and carries the lower-bound label', () => {
    const m = result.summary.months['2025-06']
    expect(m.eligible_exact).toBe(2)
    expect(m.eligible_fuzzy_unverified).toBe(1)
    expect(m.append_if_exact_only).toBe(1)
    expect(m.append_if_fuzzy_confirmed).toBe(1)
    expect(result.summary.label).toMatch(/LOWER BOUND/)
    expect(result.summary.label).toMatch(/no frequency claim/)
  })

  it('marks open-pick ids and archive-range rows ineligible', () => {
    const picks = join(dir, 'picks.json')
    writeFileSync(picks, JSON.stringify([2]))
    run(['--open-picks', picks])
    expect(pair(333)!.ineligible_reasons).toEqual(['open-pick id'])
    run()
  })

  it('is deterministic and read-only on its inputs', () => {
    const before = readFileSync(join(out, 'matched-pairs.json'), 'utf8')
    const bank = readFileSync(join(dir, 'ourbank.jsonl'), 'utf8')
    run()
    expect(readFileSync(join(out, 'matched-pairs.json'), 'utf8')).toBe(before)
    expect(readFileSync(join(dir, 'ourbank.jsonl'), 'utf8')).toBe(bank)
  })
})

describe('match-sitting-tags.py edge cases', () => {
  let d2: string
  let o2: string
  const run2 = (extra: string[] = []) => {
    const r = spawnSync('python3', [SCRIPT, '--data-dir', d2, '--out', o2, ...extra], { encoding: 'utf8' })
    expect(r.status, r.stderr).toBe(0)
    return {
      res: JSON.parse(readFileSync(join(o2, 'matched-pairs.json'), 'utf8')) as typeof result,
      rev: JSON.parse(readFileSync(join(o2, 'fuzzy-review.json'), 'utf8')) as typeof review,
      stderr: r.stderr,
    }
  }

  beforeAll(() => {
    d2 = mkdtempSync(join(tmpdir(), 'b32e-'))
    o2 = join(d2, 'out')
    const bank = [
      bankRow(114300, STEM_A, { anki_note_id: 1 }),
      bankRow(11, STEM_B, { source_file: 'ARCHIVE_ORIGINAL_x', anki_note_id: 2 }),
      bankRow(12, STEM_D, { content_hash: null }),
      bankRow(13, STEM_E + ' fuzzy ziel ' + STEM_C, { is_active: false }),
    ]
    const archive = [
      note('b1', 1, 'x', '2025-06'),
      note('b2', 2, 'x', '2025-06'),
      note('b3', 3, '(2 richtige Antworten) ' + STEM_D, '2025-06'),
      note('b4', 4, '<p>' + STEM_D + '</p>', '2025-06'),
      note('b5', 5, STEM_E + ' fuzzy ziel', '2025-06'),
      note('b6', 6, STEM_D, '2025-09'),
    ]
    writeFileSync(join(d2, 'ourbank.jsonl'), bank.map((b) => JSON.stringify(b)).join('\n') + '\n')
    writeFileSync(join(d2, 'archive-questions.jsonl'), archive.map((b) => JSON.stringify(b)).join('\n') + '\n')
  })
  afterAll(() => rmSync(d2, { recursive: true, force: true }))

  it('flags archive-range ids and ARCHIVE_ORIGINAL source rows as ineligible', () => {
    const { res } = run2()
    const byNote = (n: number) => res.pairs.find((p) => p.note_id === n)!
    expect(byNote(1).ineligible_reasons).toEqual(['archive row'])
    expect(byNote(2).ineligible_reasons).toEqual(['archive row'])
  })

  it('counts distinct bank rows when several notes map to one row, and keeps ineligible fuzzy pairs out of the review file', () => {
    const { res, rev } = run2()
    expect(res.pairs.filter((p) => p.bank_id === 12).length).toBe(3)
    expect(res.summary.months['2025-06'].append_if_exact_only).toBe(1)
    expect(res.summary.months['2025-09'].append_if_exact_only).toBe(1)
    expect(res.pairs.find((p) => p.note_id === 5)!.eligible).toBe(false)
    expect(rev).toEqual([])
  })

  it('reads open picks from a dict of id lists or string ids and warns when none are given', () => {
    const picks = join(d2, 'picks.json')
    writeFileSync(picks, JSON.stringify({ group_a: [], group_b: ['12'] }))
    const withPicks = run2(['--open-picks', picks])
    expect(withPicks.res.pairs.filter((p) => p.bank_id === 12).every((p) => p.ineligible_reasons.includes('open-pick id'))).toBe(true)
    expect(run2().stderr).toMatch(/no --open-picks file given/)
  })

  it('honours the --months override', () => {
    const { res } = run2(['--months', '2025-09'])
    expect(Object.keys(res.summary.months)).toEqual(['2025-09'])
    expect(res.pairs.every((p) => p.months.every((m) => m === '2025-09'))).toBe(true)
  })
})
