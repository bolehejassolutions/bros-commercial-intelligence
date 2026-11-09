import { createHash } from 'node:crypto';
const deny = () => { throw new Error('DEMAND_ATTRIBUTION_EVIDENCE_DENIED'); };
const plain = (v, keys) => v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype && Reflect.ownKeys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k) && Object.getOwnPropertyDescriptor(v, k)?.value !== undefined) && Object.keys(v).length === keys.length;
const id = /^[A-Za-z0-9][A-Za-z0-9:_-]{7,127}$/;
const money = v => Number.isSafeInteger(v) && v >= 0 && v <= 100_000_000;
/** Read-only tenant-scoped attribution projection. Pixel events never establish payment settlement. */
export function reconcileDemandPurchaseEvidence(scope, pixelEvents, hitpayOrders) {
  if (!plain(scope, ['tenantId', 'currency']) || !id.test(scope.tenantId) || scope.currency !== 'MYR' || !Array.isArray(pixelEvents) || !Array.isArray(hitpayOrders) || pixelEvents.length > 500 || hitpayOrders.length > 500) deny();
  const pixels = new Map();
  for (const e of pixelEvents) {
    if (!plain(e, ['tenantId','eventId','orderRef','observedAt']) || e.tenantId !== scope.tenantId || ![e.eventId,e.orderRef].every(v => typeof v === 'string' && id.test(v)) || typeof e.observedAt !== 'string' || !Number.isFinite(Date.parse(e.observedAt)) || pixels.has(e.eventId)) deny();
    pixels.set(e.eventId, e);
  }
  const orders = new Map();
  const providerIds = new Set();
  for (const o of hitpayOrders) {
    if (!plain(o, ['tenantId','orderRef','providerOrderId','status','amountMinor','currency','settledAt']) || o.tenantId !== scope.tenantId || ![o.orderRef,o.providerOrderId].every(v => typeof v === 'string' && id.test(v)) || !['SETTLED','PENDING','FAILED','REFUNDED'].includes(o.status) || !money(o.amountMinor) || o.currency !== scope.currency || (o.status === 'SETTLED' ? typeof o.settledAt !== 'string' || !Number.isFinite(Date.parse(o.settledAt)) : o.settledAt !== null) || orders.has(o.orderRef) || providerIds.has(o.providerOrderId)) deny();
    orders.set(o.orderRef, o);
    providerIds.add(o.providerOrderId);
  }
  const settled = [...orders.values()].filter(o => o.status === 'SETTLED');
  const settledRevenueMinor = settled.reduce((sum, o) => {
    const next = sum + o.amountMinor;
    if (!Number.isSafeInteger(next)) deny();
    return next;
  }, 0);
  const eventRefs = new Set([...pixels.values()].map(p => p.orderRef));
  const digest = createHash('sha256').update(JSON.stringify(['DEMAND_ATTRIBUTION_V1',scope.tenantId, [...pixels.values()].map(p => [p.eventId,p.orderRef,p.observedAt]).sort((a,b)=>a[0].localeCompare(b[0])), [...orders.values()].map(o=>[o.orderRef,o.providerOrderId,o.status,o.amountMinor,o.currency,o.settledAt]).sort((a,b)=>a[0].localeCompare(b[0]))])).digest('hex');
  return Object.freeze({state:'READ_ONLY_EVIDENCE_NOT_PROVIDER_VERIFIED', pixelPurchaseEvents:pixels.size, settledHitPayOrders:settled.length, settledRevenueMinor, settledWithPixelReference:settled.filter(o=>eventRefs.has(o.orderRef)).length, evidenceDigest:digest, metaWriteAllowed:false});
}
