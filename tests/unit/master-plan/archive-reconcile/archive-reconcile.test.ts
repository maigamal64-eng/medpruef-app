import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = join(process.cwd(), 'scripts/content/archive-reconcile')
const RECONCILE = join(DIR, 'reconcile-sip4a.py')
const ACCOUNT = join(DIR, 'account-417.py')

const S1 = 'Welche Region ist keine Praedilektionsstelle einer Vitiligo bei Erwachsenen mit hellem Hauttyp und langem Verlauf'
const S2 = 'Wo muenden die Ausfuehrungsgaenge der ekkrinen Schweissdruesen in der Haut des Menschen genau'
const S3 = 'Welcher Antikoerpernachweis ist fuer die Granulomatose mit Polyangiitis typisch und diagnostisch wegweisend'
const S4 = 'Ein 19-jaehriger Student hat Fieber und ein juckendes Exanthem mit Flecken Papeln Blaeschen und Krusten am Stamm'
const S5 = 'Welche Befunde zaehlen zu den Hauptkriterien der atopischen Dermatitis nach Hanifin und Rajka heute'
const S6 = 'Eine 72-jaehrige Patientin wird mit abschaelender Haut und Fieber in die Notaufnahme gebracht und braucht ein Foto'
const S8 = 'Welche Therapie ist bei einer akuten Appendizitis mit Perforation und diffuser Peritonitis der Standard heute'
const S9 = 'Welche Aussage zur Behandlung der schweren Verbrennung zweiten Grades im Kindesalter trifft am ehesten zu'
const S7 = 'Ein Patient mit Depression und Schlafstoerung wird von seinem Hausarzt in die psychiatrische Ambulanz ueberwiesen'

function cand(cid: string, stem: string, subject: string, sitting: string, extra: Record<string, unknown> = {}) {
  return { cid, record_id: 'r' + cid, stem, options: [], answer_as_recorded: 'x', track: 'kenntnispruefung', subject, sitting, provenance: 'unknown',
    completeness: 'partial', already_in_bank: 'no', distinctive_phrase: '', needs_image: false, ...extra }
}
const staged = (id: number, question: string, topic = 'Dermatologie', exam_dates: string[] = []) => ({ id, topic, question, answer: 'a', choices: [], exam_type: 'kenntnispruefung', exam_dates, source_file: 'ARCHIVE_ORIGINAL_A1', is_active: false, tags: ['sip4a'], content_hash: null })
const bank = (id: number, question: string, extra: Record<string, unknown> = {}) => ({ id, question, topic: 'Innere Medizin', exam_type: 'kenntnispruefung', is_active: true, source_file: 'SIP_Anki', ...extra })

type Entry = { cid: string; bucket: string; verdict: string; verdict_source: string; nearest_staged_id: number | null; nearest_active_id: number | null; staged_needs_topic_fix?: boolean; staged_needs_exam_dates?: string[]; reason: string; automatic_verdict?: string }
type Summary = { reproduced_in_scope: Record<string, number>; delta_vs_sweep: Record<string, number>; by_verdict: Record<string, number>; log_entries: number; outside_subjects_cids: string[]; staged_rows_to_activate: number }

let dir: string
let out: string

function writeJson(name: string, v: unknown) { writeFileSync(join(dir, name), JSON.stringify(v)) }
function reconcile(extra: string[] = []) {
  const r = spawnSync('python3', [RECONCILE, '--new-questions', join(dir, 'new.json'), '--staged', join(dir, 'staged.json'), '--bank', join(dir, 'bank.jsonl'), '--out', out, '--adjudications', join(dir, 'adj.json'), ...extra], { encoding: 'utf8' })
  expect(r.status, r.stderr).toBe(0)
  const read = (n: string) => JSON.parse(readFileSync(join(out, n), 'utf8'))
  return { log: read('add-or-reject-log.json') as Entry[], summary: read('summary.json') as Summary, act: read('staged-activation.json') as { staged_id: number; cids: string[]; set_topic: boolean; add_exam_dates: string[] }[] }
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'b33-'))
  out = join(dir, 'out')
  writeJson('new.json', [
    cand('Q1', S1, 'Dermatologie und Venerologie', '2026-02'),
    cand('Q2', S2 + ' [...]', 'Dermatologie', '2026-04'),
    cand('Q3', S3, 'Innere Medizin', '2026-04'),
    cand('Q4', S4, 'Dermatologie und Venerologie', '2026-02'),
    cand('Q5', S5, 'Dermatologie', '2025-11'),
    cand('Q6', S6, 'Dermatologie', '2026-02', { needs_image: true }),
    cand('Q7', S7, 'Psychiatrie', '2026-04'),
    cand('Q8', 'Sitzung ausserhalb des Zeitraums mit anderem Thema der Chirurgie und Unfallchirurgie heute', 'Chirurgie', '2024-03'),
    cand('Q9', 'Der ISS ist ein [...] der folgenden bei PatientInnen einschaetzen und weitere Worte fehlen', 'Chirurgische Fächer', '2026-04', { completeness: 'ocr_garbled' }),
    cand('Q10', 'Schon im Bank vorhanden Frage', 'Innere Medizin', '2026-04', { already_in_bank: 'probably' }),
    cand('Q12', S8, 'Chirurgie', '2026-04'),
    cand('Q13', S9 + ' und dann weiter mit etwas anderem Text', 'Chirurgie', '2026-04'),
    cand('Q14', S4 + ' Zusatz', 'Dermatologie', '2026-02'),
    cand('Q11', 'Dermatologie Frage in zwei Sitzungen gleichzeitig mit langem Text damit Shingles reichen koennen', 'Dermatologie', '2025-11 / 2026-02'),
  ])
  writeJson('staged.json', [
    staged(114384, S1.replace('Praedilektionsstelle', 'Praedilektionsstelle')),
    staged(114387, S2 + ' bei Erwachsenen', 'Dermatologie / Histologie', ['2026-04']),
  ])
  writeFileSync(join(dir, 'bank.jsonl'), [bank(68407, S3), bank(5, S8, { is_active: false }), bank(6, S8, { exam_type: 'kmp_innsbruck' }), bank(7, S9.split(' ').slice(0, 11).join(' ') + ' anderer Schluss der Frage mit mehr Woertern drumherum'), bank(114300, S4, { source_file: 'ARCHIVE_ORIGINAL_A1' })].map((b) => JSON.stringify(b)).join('\n') + '\n')
  writeJson('adj.json', { overrides: { Q6: { verdict: 'hold-image', reason: 'picture' }, Q5: { verdict: 'authoring-candidate', related_ids: [1], reason: 'author' }, Q14: { verdict: 'already-staged', nearest_staged_id: 114384, reason: 'manual' } } })
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('reconcile-sip4a.py', () => {
  it('classifies by stem match against staged rows and the active bank, and keeps an unmatched item as an authoring candidate', () => {
    const { log } = reconcile()
    const by = (c: string) => log.find((e) => e.cid === c)!
    expect(by('Q1').verdict).toBe('already-staged')
    expect(by('Q1').nearest_staged_id).toBe(114384)
    expect(by('Q2').verdict).toBe('already-staged')
    expect(by('Q3').verdict).toBe('already-active')
    expect(by('Q3').nearest_active_id).toBe(68407)
    expect(by('Q4').verdict).toBe('authoring-candidate')
  })

  it('ignores archive-range and inactive bank rows when looking for an active match', () => {
    const { log } = reconcile()
    expect(log.find((e) => e.cid === 'Q4')!.nearest_active_id).not.toBe(114300)
    expect(log.find((e) => e.cid === 'Q12')!.nearest_active_id).toBeNull()
    expect(log.find((e) => e.cid === 'Q12')!.verdict).toBe('authoring-candidate')
  })

  it('applies manual adjudications, records the automatic verdict and marks the source', () => {
    const { log } = reconcile()
    const q6 = log.find((e) => e.cid === 'Q6')!
    expect(q6.verdict).toBe('hold-image')
    expect(q6.verdict_source).toBe('manual-adjudication')
    expect(q6.automatic_verdict).toBeDefined()
    expect(log.find((e) => e.cid === 'Q1')!.verdict_source).toBe('automatic-match')
    const q14 = log.find((e) => e.cid === 'Q14')!
    expect(q14.verdict).toBe('already-staged')
    expect(q14.automatic_verdict).not.toBe('already-staged')
    expect(q14.nearest_staged_id).toBe(114384)
    const plain = reconcile(['--adjudications', '']).log
    expect(plain.find((e) => e.cid === 'Q14')!.verdict).not.toBe('already-staged')
    expect(plain.find((e) => e.cid === 'Q14')!.verdict_source).toBe('automatic-match')
  })

  it('rejects garbled text, skips already-in-bank flags and out-of-window sittings, and logs other subjects separately', () => {
    const { log, summary } = reconcile()
    const cids = log.map((e) => e.cid)
    expect(log.find((e) => e.cid === 'Q9')!.verdict).toBe('rejected')
    expect(cids).not.toContain('Q10')
    expect(cids).not.toContain('Q8')
    expect(cids).not.toContain('Q7')
    expect(summary.outside_subjects_cids).toEqual(['Q7'])
  })

  it('covers every in-scope candidate exactly once and reproduces the per-subject counts with a delta', () => {
    const { log, summary } = reconcile()
    expect(new Set(log.map((e) => e.cid)).size).toBe(log.length)
    expect(summary.log_entries).toBe(log.length)
    expect(summary.reproduced_in_scope).toEqual({ derma: 7, chirurgie: 3, innere: 1 })
    expect(summary.delta_vs_sweep).toEqual({ derma: 7 - 17, chirurgie: 3 - 8, innere: 1 - 7 })
    expect(Object.keys(summary.by_verdict).sort()).toEqual(['already-active', 'already-staged', 'authoring-candidate', 'hold-image', 'needs-review', 'rejected'])
    expect(log.every((e) => e.verdict && e.reason)).toBe(true)
  })

  it('lists staged rows to activate with the topic and exam date fixes the b20 gate needs', () => {
    const { log, act } = reconcile()
    expect(log.find((e) => e.cid === 'Q1')!.staged_needs_topic_fix).toBe(true)
    const row = act.find((a) => a.staged_id === 114387)!
    expect(row.set_topic).toBe(true)
    expect(row.add_exam_dates).toEqual([])
    expect(act.find((a) => a.staged_id === 114384)!.add_exam_dates).toEqual(['2026-02'])
  })

  it('puts a borderline similarity into needs-review and rejects an adjudication without a target id', () => {
    const { log } = reconcile()
    expect(log.find((e) => e.cid === 'Q13')!.verdict).toBe('needs-review')
    writeJson('adj-bad.json', { overrides: { Q1: { verdict: 'already-active', reason: 'x' } } })
    const r = spawnSync('python3', [RECONCILE, '--new-questions', join(dir, 'new.json'), '--staged', join(dir, 'staged.json'), '--bank', join(dir, 'bank.jsonl'), '--out', out, '--adjudications', join(dir, 'adj-bad.json')], { encoding: 'utf8' })
    expect(r.status).not.toBe(0)
    expect(r.stderr).toMatch(/needs nearest_active_id/)
  })

  it('writes ids, scores and verdicts only (no question text) and is deterministic', () => {
    reconcile()
    const text = readFileSync(join(out, 'add-or-reject-log.json'), 'utf8')
    expect(text).not.toContain('Vitiligo')
    expect(text).not.toContain('Schweissdruesen')
    const again = readFileSync(join(out, 'add-or-reject-log.json'), 'utf8')
    reconcile()
    expect(readFileSync(join(out, 'add-or-reject-log.json'), 'utf8')).toBe(again)
  })
})

describe('account-417.py', () => {
  let d2: string
  beforeAll(() => {
    d2 = mkdtempSync(join(tmpdir(), 'b33acc-'))
    mkdirSync(join(d2, 'curate'))
    mkdirSync(join(d2, 'rest'))
    const v = (cid: string, keep: boolean, tier = 'A_complete') => ({ cid, keep, tier, track: 'kenntnispruefung', subject: 'X', sitting: '2025-06' })
    writeFileSync(join(d2, 'curate/k01.json'), JSON.stringify({ batch: 'k01', verdicts: [v('Q1', true), v('Q2', true), v('Q3', true), v('Q4', true), v('Q5', true, 'B_needs_options'), v('Q6', false)] }))
    writeFileSync(join(d2, 'wave1.json'), JSON.stringify({ meta: { dropped: {} }, questions: [{ cid: 'Q1' }, { cid: 'delta:abc' }] }))
    writeFileSync(join(d2, 'rest/a1-staging.json'), JSON.stringify({ meta: { dropped: { Q3: 'merged' } }, questions: [{ cid: 'Q2' }, { cid: 'Q4' }] }))
    writeFileSync(join(d2, 'insert.json'), JSON.stringify({ dedup: { dropped: ['a1 Q4 (identical to Q2)'] } }))
  })
  afterAll(() => rmSync(d2, { recursive: true, force: true }))

  it('splits the kept set into staged, staged-not-inserted, dropped and unaccounted', () => {
    const r = spawnSync('python3', [ACCOUNT, '--curate-dir', join(d2, 'curate'), '--wave1', join(d2, 'wave1.json'), '--rest-dir', join(d2, 'rest'), '--insert-report', join(d2, 'insert.json'), '--out', join(d2, 'out')], { encoding: 'utf8' })
    expect(r.status, r.stderr).toBe(0)
    const s = JSON.parse(readFileSync(join(d2, 'out/accounting-summary.json'), 'utf8'))
    expect(s.kept).toBe(5)
    expect(s.by_status).toEqual({ staged: 2, 'staged-not-inserted': 1, 'dropped-on-purpose': 1, unaccounted: 1 })
    expect(s.staged_keys_not_in_kept).toEqual(['delta:abc'])
    expect(s.not_inserted_cids).toEqual(['Q4'])
    const un = JSON.parse(readFileSync(join(d2, 'out/unaccounted.json'), 'utf8'))
    expect(un.map((x: { cid: string }) => x.cid)).toEqual(['Q5'])
    expect(un[0].tier).toBe('B_needs_options')
  })
})
