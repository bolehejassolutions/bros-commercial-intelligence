/**
 * BROS Operator offline recommendation projection.
 * No credentials, provider IO, DB calls or write authority. NOT an executor.
 * Caller must use a verified server-derived scope and trusted evidence.
 */
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
function readUtc(value) {
  if (typeof value !== 'string' || !UTC.test(value)) return NaN;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 19) !== value.slice(0, 19)) return NaN;
  return timestamp;
}
export function selectNextActions({scope, candidates, now}) {
  if (!scope || !scope.tenantId || !scope.instanceId || !Array.isArray(scope.products) ||
      scope.products.some(product => product !== 'content' && product !== 'demand')) {
    throw new Error('A verified server-side scope is required');
  }
  const timestamp = readUtc(now);
  if (!Number.isFinite(timestamp)) throw new Error('Valid UTC evaluation time required');
  if (!Array.isArray(candidates)) throw new Error('Invalid candidates');
  const allowed = new Set(scope.products);
  const results = [];
  for (const c of candidates) {
    if (!c || c.tenantId !== scope.tenantId || c.instanceId !== scope.instanceId || !allowed.has(c.product)) continue;
    if (typeof c.actionId !== 'string' || !c.actionId.trim() || !Number.isInteger(c.priority) || c.priority < 0) continue;
    if (!['NONE_READ_ONLY','EDITORIAL','PROVIDER_WRITE','PAID_SPEND'].includes(c.approvalPolicy)) continue;
    const reasons = [];
    const seen = scope.executedKeys instanceof Set ? scope.executedKeys : new Set();
    if (!c.idempotencyKey || seen.has(c.idempotencyKey)) reasons.push('DUPLICATE_OR_MISSING_IDEMPOTENCY_KEY');
    if (!Array.isArray(c.evidence) || c.evidence.length === 0) reasons.push('NO_SOURCE_EVIDENCE');
    else {
      // Never expose a recommendation carrying another tenant/product's evidence.
      // A missing scope is also invalid: this projection cannot certify an external source.
      if (c.evidence.some(e => !e || e.tenantId !== scope.tenantId ||
          e.product !== c.product || (e.instanceId !== undefined && e.instanceId !== c.instanceId))) continue;
      for (const e of c.evidence) {
        const collectedAt = readUtc(e.collectedAt);
        const observedAt = readUtc(e.observedAt);
        if (!['OBSERVED', 'VERIFIED'].includes(e.status)) reasons.push('UNVERIFIED_EVIDENCE');
        if (!Number.isFinite(collectedAt) || !Number.isFinite(observedAt) ||
            !Number.isFinite(c.freshnessBudgetMs) || c.freshnessBudgetMs <= 0 ||
            observedAt > collectedAt || collectedAt > timestamp ||
            timestamp - observedAt > c.freshnessBudgetMs) reasons.push('STALE_OR_UNBOUNDED_EVIDENCE');
      }
    }
    let state = 'PROPOSED';
    if (reasons.some(r => r.includes('IDEMPOTENCY'))) state = 'BLOCKED';
    else if (reasons.length) state = 'NEEDS_EVIDENCE';
    else if (c.approvalPolicy !== 'NONE_READ_ONLY') state = 'READY_FOR_REVIEW';
    results.push({
      actionId: c.actionId,
      title: typeof c.title === 'string' ? c.title : 'Review action',
      product: c.product,
      priority: c.priority,
      state,
      blockedBy: [...new Set(reasons)].sort(),
      requiresApproval: c.approvalPolicy !== 'NONE_READ_ONLY',
      executionAllowed: false, // A recommender has no write authority even when review is complete.
    });
  }
  const stateRank = {PROPOSED:0, READY_FOR_REVIEW:1, NEEDS_EVIDENCE:2, BLOCKED:3};
  results.sort((a,b) => a.priority-b.priority || stateRank[a.state]-stateRank[b.state] || a.actionId.localeCompare(b.actionId));
  return {primary:results[0] ?? null, secondary:results.slice(1,3), considered:results.length};
}
