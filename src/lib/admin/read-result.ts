/** Reject a failed read before it can become a successful zero/empty result. */
export function assertReadSucceeded(result: { error?: unknown }): void {
  if (result.error) throw result.error;
}

export async function checkedRead<T extends { error?: unknown }>(query: PromiseLike<T>): Promise<T> {
  const result = await query;
  assertReadSucceeded(result);
  return result;
}
