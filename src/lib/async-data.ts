export type RegionState = 'idle' | 'loading' | 'slow' | 'ok' | 'empty' | 'error';
export class DataResponseError extends Error {
  constructor(public status: number) { super('Data could not be loaded'); }
}
export async function checkedJson<T>(response: Response, valid: (value: unknown) => value is T): Promise<T> {
  if (!response.ok) throw new DataResponseError(response.status);
  const value: unknown = await response.json();
  if (!valid(value)) throw new DataResponseError(502);
  return value;
}
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** Each new filter/request invalidates its predecessor, even if fetch ignores abort. */
export function createRequestSequence() {
  let token = 0;
  let controller: AbortController | undefined;
  return {
    begin() {
      controller?.abort();
      controller = new AbortController();
      const ownToken = ++token;
      return { signal: controller.signal, current: () => ownToken === token && !controller?.signal.aborted };
    },
    cancel() { ++token; controller?.abort(); },
  };
}
