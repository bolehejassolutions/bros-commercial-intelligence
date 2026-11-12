import {
  isDemandEvidenceTimestamp,
  reconcileDemandPurchaseEvidence,
  snapshotDemandEvidenceRecord,
} from './attribution-evidence.mjs';

const deny = () => { throw new Error('DEMAND_SETTLEMENT_SOURCE_UNVERIFIED'); };
const TENANT_ID = /^[A-Za-z0-9][A-Za-z0-9:_-]{7,127}$/;
const SETTLEMENT_FIELDS = ['tenantId', 'source', 'retrievedAt', 'complete', 'orders'];
const MAX_AGE_MS = 15 * 60 * 1000;

/** Read-only boundary for an injected server adapter and tenant authorization check. */
export async function observeDemandSettlements({ tenantId, currency, readSettlements, authorizeTenant, now }) {
  if (typeof tenantId !== 'string' || !TENANT_ID.test(tenantId) || currency !== 'MYR' ||
      typeof readSettlements !== 'function' || typeof authorizeTenant !== 'function' ||
      !isDemandEvidenceTimestamp(now)) deny();

  try {
    if (await authorizeTenant(tenantId) !== true) deny();
    const result = await readSettlements({ tenantId, limit: 500 });
    const response = snapshotDemandEvidenceRecord(result, SETTLEMENT_FIELDS);
    if (response.tenantId !== tenantId || response.source !== 'HITPAY_AUTHENTICATED_SERVER' ||
        response.complete !== true || !isDemandEvidenceTimestamp(response.retrievedAt) ||
        response.retrievedAt > now || Date.parse(now) - Date.parse(response.retrievedAt) > MAX_AGE_MS) deny();

    const evidence = reconcileDemandPurchaseEvidence({ tenantId, currency }, [], response.orders, response.retrievedAt);
    if (await authorizeTenant(tenantId) !== true) deny();

    return Object.freeze({
      state: 'SERVER_ADAPTER_EVIDENCE_UNVERIFIED_PROVIDER',
      sourceRetrievedAt: response.retrievedAt,
      settledHitPayOrders: evidence.settledHitPayOrders,
      settledRevenueMinor: evidence.settledRevenueMinor,
      verifiedSettledHitPayOrders: null,
      verifiedSettledRevenueMinor: null,
      providerAuthenticationVerified: false,
      tenantAuthorizationVerifiedForProvider: false,
      evidenceDigest: evidence.evidenceDigest,
      metaWriteAllowed: false,
    });
  } catch {
    deny();
  }
}
