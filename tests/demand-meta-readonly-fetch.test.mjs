import test from 'node:test';
import assert from 'node:assert/strict';
import {readDemandMetaAds} from '../lib/demand/meta-readonly-fetch.mjs';
const accountId='1997776120879476',campaignId='120251158023300697',retrievedAt='2026-11-10T01:00:00.000Z';
const row={id:'120251158023300699',adset_id:'120251158023300698',campaign_id:campaignId,account_id:accountId,effective_status:'PAUSED',updated_time:'2026-11-10T00:59:00.000Z',insights:{data:[{impressions:'12',spend:'5.00'}]}};
const base={tenantId:'tenant-a',authorizedTenantId:'tenant-a',accountId,campaignId,accessToken:'secret-test-token',retrievedAt,maxPages:3};
const mock=(data,ok=true)=>async (url,opts)=>{assert.equal(opts.method,'GET');assert.equal(opts.redirect,'error');assert.equal(new URL(url).searchParams.has('access_token'),false);return {ok,json:async()=>data}};
test('read-only account scoped GET preserves provider-unverified status',async()=>{const r=await readDemandMetaAds({...base,fetchImpl:mock({data:[row]})});assert.equal(r.spendMinor,500);assert.equal(r.providerAuthenticationVerified,false);assert.equal(r.metaWriteAllowed,false)});
test('no rows remain unknown not zero',async()=>{const r=await readDemandMetaAds({...base,fetchImpl:mock({data:[]})});assert.equal(r.state,'NO_ROWS_NOT_ZERO');assert.equal(r.spendMinor,null)});
test('reject tenant mismatch before fetching',async()=>{let calls=0;await assert.rejects(readDemandMetaAds({...base,authorizedTenantId:'other',fetchImpl:async()=>{calls++}}),/UNVERIFIED/);assert.equal(calls,0)});
test('reject cross-account/campaign, invalid metrics and non-GET provider failure',async()=>{for(const bad of [{...row,campaign_id:'123456789'},{...row,account_id:'123456789'},{...row,insights:{data:[{impressions:'12',spend:'NaN'}]}}])await assert.rejects(readDemandMetaAds({...base,fetchImpl:mock({data:[bad]})}),/UNVERIFIED/);await assert.rejects(readDemandMetaAds({...base,fetchImpl:mock({data:[]},false)}),/UNVERIFIED/)});
test('reject untrusted pagination URL, duplicate pages, and overflow',async()=>{for(const next of ['https://evil.example/steal','https://graph.facebook.com/v22.0/act_123456789/ads'])await assert.rejects(readDemandMetaAds({...base,fetchImpl:mock({data:[],paging:{next}})}),/UNVERIFIED/);await assert.rejects(readDemandMetaAds({...base,maxPages:1,fetchImpl:mock({data:[],paging:{next:'https://graph.facebook.com/v22.0/act_'+accountId+'/ads?page=2'}})}),/UNVERIFIED/)});
test('reject thrown provider errors without exposing secrets',async()=>{await assert.rejects(readDemandMetaAds({...base,fetchImpl:async()=>{throw Error('secret-test-token')}}),e=>e.message==='DEMAND_META_READ_UNVERIFIED')});

test('accept actual Meta numeric-offset updated_time and normalize to canonical UTC',async()=>{
 const r=await readDemandMetaAds({...base,fetchImpl:mock({data:[{...row,updated_time:'2026-11-10T08:59:00+0800'}]})});
 assert.equal(r.rows[0].sourceUpdatedAt,'2026-11-10T00:59:00.000Z');
});
test('missing inline Insights is unknown, never zero',async()=>{
 const {insights,...withoutInsights}=row;
 const r=await readDemandMetaAds({...base,fetchImpl:mock({data:[withoutInsights]})});
 assert.equal(r.state,'ROWS_OBSERVED_UNVERIFIED_PROVIDER');
 assert.equal(r.spendMinor,null);
 assert.equal(r.impressions,null);
});
test('reject impossible Meta calendar date and timestamp later than snapshot',async()=>{
 for (const updated_time of ['2026-02-30T08:59:00+0800','2026-11-10T10:59:00+0800'])
  await assert.rejects(readDemandMetaAds({...base,fetchImpl:mock({data:[{...row,updated_time}]})}),/UNVERIFIED/);
});

test('pagination cannot change projection fields, page size, or inject provider parameters',async()=>{
 const root='https://graph.facebook.com/v22.0/act_'+accountId+'/ads';
 const fields='id,adset_id,campaign_id,account_id,effective_status,insights.fields(impressions,spend),updated_time';
 for(const suffix of ['?after=cursor','?fields='+encodeURIComponent(fields)+'&limit=1&after=cursor','?fields='+encodeURIComponent(fields)+'&limit=100&after=cursor&filtering=secret','?fields='+encodeURIComponent(fields)+'&limit=100&after=cursor&after=second','?fields='+encodeURIComponent(fields)+'&limit=100']) {
  let calls=0;
  await assert.rejects(readDemandMetaAds({...base,fetchImpl:async()=>{calls++;return {ok:true,json:async()=>({data:[],paging:calls===1?{next:root+suffix}:undefined})}}}),/UNVERIFIED/);
  assert.equal(calls,1);
 }
});
test('bounded cursor-only continuation remains read-only',async()=>{
 const first='https://graph.facebook.com/v22.0/act_'+accountId+'/ads?fields=id,adset_id,campaign_id,account_id,effective_status,insights.fields(impressions,spend),updated_time&limit=100';
 let calls=0;
 const result=await readDemandMetaAds({...base,fetchImpl:async(url,opts)=>{
  assert.equal(opts.method,'GET');calls++;
  if(calls===2)assert.equal(new URL(url).searchParams.get('after'),'cursor123');
  return {ok:true,json:async()=>calls===1?{data:[],paging:{next:first+'&after=cursor123'}}:{data:[row]}};
 }});
 assert.equal(calls,2);assert.equal(result.rows.length,1);
});
