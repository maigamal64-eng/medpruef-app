/** A requested simulation batch is complete only when it returns the entire
 * planned number of rows. Empty/short batches must not become a valid exam. */
export function isExamBatchComplete(received: number, requested: number): boolean {
  return Number.isInteger(received) && Number.isInteger(requested) && requested > 0 && received >= requested;
}
