import { projectDemandMetaSnapshot } from './meta-readonly-snapshot.mjs';
const deny = () => { throw new Error('DEMAND_META_READ_UNVERIFIED'); };
const id = /^[0-9]{6,30}$/;
const stamp = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const own = (o, keys) => o !== null && typeof o === 'object' && Object.getPrototypeOf(o) === Object.prototype && Reflect.ownKeys(o).length === keys.length && keys.every(k => { const d = Object.getOwnPropertyDescriptor(o,k); return d && d.enumerable && 'value' in d; });
/** Read-only adapter. Credentials are injected server-side, never returned. No Meta writes or provider attestation inferred from fixtures. */
export async function readDemandMetaAds({tenantId, authorizedTenantId, accountId, campaignId, accessToken, fetchImpl, retrievedAt, maxPages = 3}) {
 try {
  if (!own(arguments[0], ['tenantId','authorizedTenantId','accountId','campaignId','accessToken','fetchImpl','retrievedAt','maxPages']) ||
      typeof tenantId !== 'string' || !tenantId || tenantId !== authorizedTenantId ||
      !id.test(accountId) || !id.test(campaignId) || typeof accessToken !== 'string' || accessToken.length < 8 ||
      typeof fetchImpl !== 'function' || !stamp(retrievedAt) || !Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 5) deny();
  const rows = []; let next = 'https://graph.facebook.com/v22.0/act_' + accountId + '/ads?fields=id,adset_id,campaign_id,account_id,effective_status,insights.fields(impressions,spend),updated_time&limit=100';
  const visited = new Set();
  for (let page = 0; next !== null; page++) {
   if (page >= maxPages || visited.has(next)) deny();
   visited.add(next);
   const url = new URL(next);
   if (url.origin !== 'https://graph.facebook.com' || url.pathname !== '/v22.0/act_' + accountId + '/ads' ||
       url.searchParams.has('access_token') || url.username || url.password) deny();
   const response = await fetchImpl(url.toString(), {method:'GET',headers:{Authorization:'Bearer '+accessToken},redirect:'error',signal:AbortSignal.timeout(8000)});
   if (!response || response.ok !== true || typeof response.json !== 'function') deny();
   const data = await response.json();
   if (!data || !Array.isArray(data.data) || data.data.length > 100 || (data.paging !== undefined && (Object.getPrototypeOf(data.paging) !== Object.prototype || (data.paging.next !== undefined && data.paging.next !== null && typeof data.paging.next !== 'string')))) deny();
   for (const r of data.data) {
    if (!r || !id.test(r.id) || !id.test(r.adset_id) || r.campaign_id !== campaignId || r.account_id !== accountId ||
        typeof r.effective_status !== 'string' || !stamp(r.updated_time) || !r.insights || !Array.isArray(r.insights.data) || r.insights.data.length !== 1) deny();
    const m = r.insights.data[0];
    if (!m || !/^(0|[1-9][0-9]*)$/.test(m.impressions) || !/^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$/.test(m.spend)) deny();
    const spendMinor = Math.round(Number(m.spend)*100), impressions = Number(m.impressions);
    if (!Number.isSafeInteger(spendMinor) || !Number.isSafeInteger(impressions)) deny();
    rows.push({accountId,campaignId,adsetId:r.adset_id,adId:r.id,effectiveStatus:r.effective_status,impressions,spendMinor,sourceUpdatedAt:r.updated_time});
    if (rows.length > 500) deny();
   }
   next = data.paging?.next ?? null;
  }
  return projectDemandMetaSnapshot({accountId,campaignId,retrievedAt,complete:true,rows,source:'META_SERVER_ADAPTER_UNVERIFIED'});
 } catch { deny(); }
}
