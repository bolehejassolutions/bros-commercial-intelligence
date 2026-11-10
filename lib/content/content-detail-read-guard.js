/** Monotonic guard for asynchronous CONTENT campaign reads.
 * A verified draft readback supersedes any GET started before it.
 * Pure and independent of database, React, credentials and providers.
 */
export function createContentDetailReadGuard() {
  let epoch = 0;
  return {
    beginRead() { return ++epoch; },
    supersedeWithVerifiedDraft() { ++epoch; },
    isCurrent(token) { return Number.isSafeInteger(token) && token > 0 && token === epoch; }
  };
}
