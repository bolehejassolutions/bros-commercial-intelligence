import { createHash } from 'node:crypto';

const deny = () => { throw new Error('DEMAND_ATTRIBUTION_EVIDENCE_DENIED'); };
const validId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9:_-]{7,127}$/.test(value);
const money = value => Number.isSafeInteger(value) && value >= 0 && value <= 100_000_000;
const MAX_ROWS = 500;
const PIXEL_FIELDS = ['tenantId', 'eventId', 'orderRef', 'observedAt'];
const ORDER_FIELDS = ['tenantId', 'orderRef', 'providerOrderId', 'status', 'amountMinor', 'currency', 'settledAt'];

export const isDemandEvidenceTimestamp = value => typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

// Validate and copy own data in a single read, without invoking accessors or
// re-reading properties through a mutable adapter object after validation.
export function snapshotDemandEvidenceRecord(value, keys) {
  if (value === null || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype ||
      Reflect.ownKeys(value).length !== keys.length) deny();
  return Object.fromEntries(keys.map(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) deny();
    return [key, descriptor.value];
  }));
}

function snapshotRows(value, fields) {
  if (!Array.isArray(value) || value[Symbol.iterator] !== Array.prototype[Symbol.iterator]) deny();
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > MAX_ROWS ||
      Reflect.ownKeys(value).length !== length + 1) deny();
  return Array.from({ length }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) deny();
    return snapshotDemandEvidenceRecord(descriptor.value, fields);
  });
}

/** Tenant-scoped, read-only projection of unverified Pixel and settlement observations. */
export function reconcileDemandPurchaseEvidence(inputScope, pixelEvents, hitpayOrders, settlementAsOf = null) {
  try {
    const scope = snapshotDemandEvidenceRecord(inputScope, ['tenantId', 'currency']);
    if (!validId(scope.tenantId) || scope.currency !== 'MYR' ||
        (settlementAsOf !== null && !isDemandEvidenceTimestamp(settlementAsOf))) deny();

    const pixels = new Map();
    for (const event of snapshotRows(pixelEvents, PIXEL_FIELDS)) {
      if (event.tenantId !== scope.tenantId || !validId(event.eventId) || !validId(event.orderRef) ||
          !isDemandEvidenceTimestamp(event.observedAt) || pixels.has(event.eventId)) deny();
      pixels.set(event.eventId, event);
    }

    const orders = new Map();
    const providerIds = new Set();
    for (const order of snapshotRows(hitpayOrders, ORDER_FIELDS)) {
      if (order.tenantId !== scope.tenantId || !validId(order.orderRef) || !validId(order.providerOrderId) ||
          !['SETTLED', 'PENDING', 'FAILED', 'REFUNDED'].includes(order.status) ||
          !money(order.amountMinor) || order.currency !== scope.currency || orders.has(order.orderRef) ||
          providerIds.has(order.providerOrderId)) deny();
      if (order.status === 'SETTLED') {
        if (!isDemandEvidenceTimestamp(order.settledAt) ||
            (settlementAsOf !== null && order.settledAt > settlementAsOf)) deny();
      } else if (order.settledAt !== null) deny();
      orders.set(order.orderRef, order);
      providerIds.add(order.providerOrderId);
    }

    const settled = [...orders.values()].filter(order => order.status === 'SETTLED');
    const settledRevenueMinor = settled.reduce((sum, order) => sum + order.amountMinor, 0);
    const eventRefs = new Set([...pixels.values()].map(event => event.orderRef));
    const pixelEvidence = [...pixels.values()].map(event => [event.eventId, event.orderRef, event.observedAt]);
    const orderEvidence = [...orders.values()].map(order => [
      order.orderRef, order.providerOrderId, order.status, order.amountMinor, order.currency, order.settledAt,
    ]);
    const digest = createHash('sha256').update(JSON.stringify([
      'DEMAND_ATTRIBUTION_V1', scope.tenantId,
      pixelEvidence.sort((a, b) => a[0].localeCompare(b[0])),
      orderEvidence.sort((a, b) => a[0].localeCompare(b[0])),
    ])).digest('hex');

    return Object.freeze({
      state: 'READ_ONLY_EVIDENCE_NOT_PROVIDER_VERIFIED',
      pixelPurchaseEvents: pixels.size,
      settledHitPayOrders: settled.length,
      settledRevenueMinor,
      settledWithPixelReference: settled.filter(order => eventRefs.has(order.orderRef)).length,
      verifiedSettledHitPayOrders: null,
      verifiedSettledRevenueMinor: null,
      verifiedPixelOrderJoins: null,
      evidenceDigest: digest,
      metaWriteAllowed: false,
    });
  } catch {
    deny();
  }
}
