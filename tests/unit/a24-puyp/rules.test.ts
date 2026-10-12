import { describe, expect, it } from 'vitest';
import * as server from '@/lib/puyp';
import {
  failHelperKey, failPathFor, fitWithin, formatFileSize, jpegName, MAX_PROOF_BYTES, parseStatus, pickProof,
  proofProblem, proofSignature, PUYP_COMPLETION_THRESHOLD_PCT, PUYP_MAX_EXTENSIONS, showsGuaranteePanel,
  shouldDownscale, uploadErrorKey,
} from '@/app/dashboard/exam-result/_parts/rules';

const base = { eligible: false, meets_completion_gate: false, subscription: undefined, reason_code: undefined } as const;

describe('a24 PUYP fail path (pick-ux-exm-46 A)', () => {
  it('mirrors the server constants', () => {
    expect(PUYP_COMPLETION_THRESHOLD_PCT).toBe(server.PUYP_COMPLETION_THRESHOLD_PCT);
    expect(PUYP_MAX_EXTENSIONS).toBe(server.PUYP_MAX_EXTENSIONS);
  });
  it('only an eligible learner over the gate claims; everyone else records without proof', () => {
    expect(failPathFor({ ...base, eligible: true, meets_completion_gate: true })).toEqual({ mode: 'claim' });
    expect(failPathFor({ ...base, eligible: true })).toEqual({ mode: 'record', block: 'below_gate' });
    expect(failPathFor({ ...base, reason_code: 'no_subscription' })).toEqual({ mode: 'record', block: 'no_plan' });
    expect(failPathFor({ ...base, reason_code: 'tier_not_eligible', subscription: { tier: 'monthly', expires_at: null, puyp_extensions_used: 0 } })).toEqual({ mode: 'record', block: 'no_plan' });
    expect(failPathFor({ ...base, reason_code: 'cap_reached', subscription: { tier: 'premium_pass_guaranteed', expires_at: null, puyp_extensions_used: 2 } })).toEqual({ mode: 'record', block: 'cap' });
    expect(failPathFor({ ...base, subscription: { tier: 'premium_pass_guaranteed', expires_at: null, puyp_extensions_used: 2 } })).toEqual({ mode: 'record', block: 'cap' });
  });
  it('every path has visible helper text', () => {
    expect(failHelperKey({ mode: 'claim' })).toBe('failHelperClaim');
    expect(failHelperKey({ mode: 'record', block: 'cap' })).toBe('failHelperCap');
    expect(failHelperKey({ mode: 'record', block: 'below_gate' })).toBe('failHelperBelowGate');
    expect(failHelperKey({ mode: 'record', block: 'no_plan' })).toBe('failHelperNoPlan');
  });
  it('the guarantee panel shows only with a guarantee plan', () => {
    expect(showsGuaranteePanel({ eligible: true })).toBe(true);
    expect(showsGuaranteePanel({ eligible: false, reason_code: 'cap_reached' })).toBe(true);
    expect(showsGuaranteePanel({ eligible: false, reason_code: 'no_subscription' })).toBe(false);
  });
  it('a malformed or error status body is not a status (no upsell on load failure)', () => {
    expect(parseStatus({ error: 'Internal error' })).toBeNull();
    expect(parseStatus(null)).toBeNull();
    const s = parseStatus({ eligible: true, meets_completion_gate: true, exam_type: 'pharma', exam_date: '2026-10-01', qbank_completion_pct: 71.5, reason_code: 'bogus' });
    expect(s).toMatchObject({ eligible: true, exam_type: 'pharma', qbank_completion_pct: 71.5, qbank_total: 0 });
    expect(s?.reason_code).toBeUndefined();
    expect(parseStatus({ eligible: false, meets_completion_gate: false, exam_type: 'zahn' })?.exam_type).toBeNull();
  });
});

describe('a24 proof upload (EXM-47)', () => {
  it('downscales images only and never upscales', () => {
    expect(shouldDownscale({ type: 'image/heic' })).toBe(true);
    expect(shouldDownscale({ type: 'application/pdf' })).toBe(false);
    expect(fitWithin(4032, 3024)).toEqual({ width: 2000, height: 1500 });
    expect(fitWithin(3024, 4032)).toEqual({ width: 1500, height: 2000 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    expect(jpegName('IMG_0001.HEIC')).toBe('IMG_0001.jpg');
    expect(jpegName('.hidden')).toBe('.hidden.jpg');
  });
  it('keeps the smaller allowed file and falls back to the original', () => {
    const original = { type: 'image/png', size: 5_000_000 };
    expect(pickProof(original, { type: 'image/jpeg', size: 900_000 })).toEqual({ type: 'image/jpeg', size: 900_000 });
    expect(pickProof(original, { type: 'image/jpeg', size: 6_000_000 })).toBe(original);
    expect(pickProof(original, null)).toBe(original);
    const heic = { type: 'image/heic', size: 3_000_000 };
    expect(pickProof(heic, { type: 'image/jpeg', size: 4_000_000 }).type).toBe('image/jpeg');
  });
  it('checks type and the 10 MB cap after preparation', () => {
    expect(proofProblem({ type: 'application/pdf', size: MAX_PROOF_BYTES })).toBeNull();
    expect(proofProblem({ type: 'application/pdf', size: MAX_PROOF_BYTES + 1 })).toBe('proofTooLarge');
    expect(proofProblem({ type: 'image/heic', size: 10 })).toBe('proofWrongType');
  });
  it('maps timeouts, offline and server statuses to learner copy', () => {
    expect(uploadErrorKey({ error: new DOMException('timed out', 'TimeoutError') })).toBe('uploadTooSlow');
    expect(uploadErrorKey({ error: new DOMException('aborted', 'AbortError') })).toBe('uploadTooSlow');
    expect(uploadErrorKey({ error: new TypeError('Failed to fetch') })).toBe('uploadOffline');
    expect(uploadErrorKey({ status: 413 })).toBe('proofTooLarge');
    expect(uploadErrorKey({ status: 415 })).toBe('proofWrongType');
    expect(uploadErrorKey({ status: 403 })).toBe('uploadNotEligible');
    expect(uploadErrorKey({ status: 422 })).toBe('uploadBelowGate');
    expect(uploadErrorKey({ status: 500 })).toBe('uploadFailed');
  });
  it('a retry of the same prepared file keeps one action signature', () => {
    const file = { name: 'IMG.jpg', size: 812_000, lastModified: 1_700_000_000_000 };
    expect(proofSignature('u', 'pharma', '2026-10-01', file)).toBe(proofSignature('u', 'pharma', '2026-10-01', { ...file }));
    expect(proofSignature('u', 'pharma', '2026-10-02', file)).not.toBe(proofSignature('u', 'pharma', '2026-10-01', file));
  });
  it('formats sizes in the page locale', () => {
    expect(formatFileSize(2_621_440, 'de-AT')).toBe('2,5 MB');
    expect(formatFileSize(300_000, 'en-GB')).toBe('293 KB');
  });
});
