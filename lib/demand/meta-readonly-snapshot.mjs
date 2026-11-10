const fail = () => { throw new Error('DEMAND_META_READ_UNVERIFIED'); };
const id = /^[0-9]{6,30}$/;
const stamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const plain = (value, keys) => value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype && Reflect.ownKeys(value).length === keys.length && keys.every(key => { const descriptor = Object.getOwnPropertyDescriptor(value, key); return descriptor && 'value' in descriptor && descriptor.enumerable; });
const metric = value => value === null || (Number.isSafeInteger(value) && value >= 0);
/** Pure read-only projection; caller must authenticate provider, tenant and account independently. */
export function projectDemandMetaSnapshot({accountId, campaignId, retrievedAt, complete, rows, source}) {
 try {
  if (!plain(arguments[0], ['accountId','campaignId','retrievedAt','complete','rows','source']) || !id.test(accountId) || !id.test(campaignId) || !stamp(retrievedAt) || complete !== true || source !== 'META_SERVER_ADAPTER_UNVERIFIED' || !Array.isArray(rows) || rows.length > 500) fail();
  const seen = new Set();
  const output = [];
  for (const row of rows) {
   if (!plain(row, ['accountId','campaignId','adsetId','adId','effectiveStatus','impressions','spendMinor','sourceUpdatedAt']) || row.accountId !== accountId || row.campaignId !== campaignId || !id.test(row.adsetId) || !id.test(row.adId) || !['ACTIVE','PAUSED','DELETED','ARCHIVED','IN_PROCESS','WITH_ISSUES','DISAPPROVED','PENDING_REVIEW','PREAPPROVED','PENDING_BILLING_CAMPAIGN','PENDING_BILLING_ADSET','CAMPAIGN_PAUSED','ADSET_PAUSED'].includes(row.effectiveStatus) || !metric(row.impressions) || !metric(row.spendMinor) || !stamp(row.sourceUpdatedAt) || Date.parse(row.sourceUpdatedAt) > Date.parse(retrievedAt) || seen.has(row.adId)) fail();
   seen.add(row.adId);
   output.push(Object.freeze({...row}));
  }
  const sum = key => { if (!output.length || output.some(row=>row[key]===null)) return null; let total=0; for(const row of output){ total+=row[key]; if(!Number.isSafeInteger(total)) fail(); } return total; };
  return Object.freeze({state: output.length ? 'ROWS_OBSERVED_UNVERIFIED_PROVIDER' : 'NO_ROWS_NOT_ZERO', accountId, campaignId, sourceRetrievedAt:retrievedAt, rows:Object.freeze(output), impressions:sum('impressions'), spendMinor:sum('spendMinor'), providerAuthenticationVerified:false, metaWriteAllowed:false});
 } catch { fail(); }
}
