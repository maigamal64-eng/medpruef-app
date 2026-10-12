import { DataResponseError, classifyFailure, type FailureReason } from './async-data';

export interface ReadFailureTelemetry {
  /** HTTP status when the server answered, otherwise "none". */
  status: number | 'none';
  /** Failure class plus the error's name, for example "timeout:TimeoutError". */
  reason: string;
}

/**
 * Issue 5 (user activity 2026-10-12): StudyReadError labelled every error
 * that was neither a DataResponseError nor a TypeError "malformed", so an
 * 8 s page timeout (a DOMException) and a 500 read the same. Report the real
 * class (classifyFailure), the HTTP status when there is one and the error
 * name, in the two keys error_state_shown already allows (status, reason).
 */
export function describeReadFailure(error: unknown, online = true): ReadFailureTelemetry {
  const kind: FailureReason = classifyFailure(error, online);
  const status = error instanceof DataResponseError ? error.status : 'none';
  const rawName = error instanceof Error || error instanceof DOMException ? error.name : typeof error;
  const name = /^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(rawName) ? rawName : 'Unknown';
  return { status, reason: `${kind}:${name}` };
}
