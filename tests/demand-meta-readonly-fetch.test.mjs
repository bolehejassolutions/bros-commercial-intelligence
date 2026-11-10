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
 const filtering=encodeURIComponent(JSON.stringify([{field:'campaign.id',operator:'EQUAL',value:campaignId}]));
 for(const suffix of ['?after=cursor','?fields='+encodeURIComponent(fields)+'&limit=1&filtering='+filtering+'&after=cursor','?fields='+encodeURIComponent(fields)+'&limit=100&after=cursor&filtering=secret','?fields='+encodeURIComponent(fields)+'&limit=100&filtering='+filtering+'&after=cursor&after=second','?fields='+encodeURIComponent(fields)+'&limit=100&filtering='+filtering]) {
  let calls=0;
  await assert.rejects(readDemandMetaAds({...base,fetchImpl:async()=>{calls++;return {ok:true,json:async()=>({data:[],paging:calls===1?{next:root+suffix}:undefined})}}}),/UNVERIFIED/);
  assert.equal(calls,1);
 }
});
test('bounded cursor-only continuation remains read-only',async()=>{
 const first='https://graph.facebook.com/v22.0/act_'+accountId+'/ads?fields=id,adset_id,campaign_id,account_id,effective_status,insights.fields(impressions,spend),updated_time&limit=100&filtering='+encodeURIComponent(JSON.stringify([{field:'campaign.id',operator:'EQUAL',value:campaignId}]));
 let calls=0;
 const result=await readDemandMetaAds({...base,fetchImpl:async(url,opts)=>{
  assert.equal(opts.method,'GET');calls++;
  if(calls===2)assert.equal(new URL(url).searchParams.get('after'),'cursor123');
  return {ok:true,json:async()=>calls===1?{data:[],paging:{next:first+'&after=cursor123'}}:{data:[row]}};
 }});
 assert.equal(calls,2);assert.equal(result.rows.length,1);
});

test('reject oversized, unsafe, or fragment-bearing pagination cursors before second fetch',async()=>{
 const first='https://graph.facebook.com/v22.0/act_'+accountId+'/ads?fields=id,adset_id,campaign_id,account_id,effective_status,insights.fields(impressions,spend),updated_time&limit=100&filtering='+encodeURIComponent(JSON.stringify([{field:'campaign.id',operator:'EQUAL',value:campaignId}]));
 for(const suffix of ['&after='+('A'.repeat(513)),'&after=cursor%2Funsafe','&after=cursor%20space','&after=cursor#fragment']){
  let calls=0;
  await assert.rejects(readDemandMetaAds({...base,fetchImpl:async()=>{
   calls++;
   return {ok:true,json:async()=>({data:[],paging:{next:first+suffix}})};
  }}),/DEMAND_META_READ_UNVERIFIED/);
  assert.equal(calls,1,'invalid cursor must not trigger another provider call');
 }
});

test('Meta account ads GET is campaign-filtered before provider retrieval',async()=>{
 let calls=0;
 await readDemandMetaAds({...base,fetchImpl:async(url,options)=>{
  calls++;
  assert.equal(options.method,'GET');
  assert.deepEqual(JSON.parse(new URL(url).searchParams.get('filtering')),[{field:'campaign.id',operator:'EQUAL',value:campaignId}]);
  return {ok:true,json:async()=>({data:[row]})};
 }});
 assert.equal(calls,1);
});
test('pagination cannot switch campaign filtering or remove it',async()=>{
 const first='https://graph.facebook.com/v22.0/act_'+accountId+'/ads?fields=id,adset_id,campaign_id,account_id,effective_status,insights.fields(impressions,spend),updated_time&limit=100';
 for(const filtering of ['', '&filtering='+encodeURIComponent(JSON.stringify([{field:'campaign.id',operator:'EQUAL',value:'123456789'}]))]){
  let calls=0;
  await assert.rejects(readDemandMetaAds({...base,fetchImpl:async()=>{
   calls++;return {ok:true,json:async()=>({data:[],paging:{next:first+filtering+'&after=cursor'}})};
  }}),/UNVERIFIED/);
  assert.equal(calls,1);
 }
});

// Provider pagination may repeat an ad when its status changes between page reads.
// Never double-count impressions or spend in a supposedly complete snapshot.
test('reject duplicate ad IDs across pages rather than double-counting spend',async()=>{
 const first='https://graph.facebook.com/v22.0/act_'+accountId+'/ads?fields=id,adset_id,campaign_id,account_id,effective_status,insights.fields(impressions,spend),updated_time&limit=100&filtering='+encodeURIComponent(JSON.stringify([{field:'campaign.id',operator:'EQUAL',value:campaignId}]));
 let calls=0;
 await assert.rejects(readDemandMetaAds({...base,fetchImpl:async(url,opts)=>{
  assert.equal(opts.method,'GET');calls++;
  return {ok:true,json:async()=>calls===1?{data:[row],paging:{next:first+'&after=cursor123'}}:{data:[{...row,insights:{data:[{impressions:'99',spend:'9.00'}]}}]}};
 }}),/DEMAND_META_READ_UNVERIFIED/);
 assert.equal(calls,2);
});
test('reject duplicate ad IDs within one provider page',async()=>{
 await assert.rejects(readDemandMetaAds({...base,fetchImpl:mock({data:[row,{...row}]})}),/DEMAND_META_READ_UNVERIFIED/);
});

test('reject incomplete nested Insights pagination instead of undercounting metrics',async()=>{
 for(const paging of [{next:'https://graph.facebook.com/v22.0/insights?after=more'},{next:'cursor-next'}]){
  await assert.rejects(readDemandMetaAds({...base,fetchImpl:mock({data:[{...row,insights:{data:[{impressions:'12',spend:'5.00'}],paging}}]})}),/DEMAND_META_READ_UNVERIFIED/);
 }
});
test('accept complete single-row Insights while retaining observed metrics',async()=>{
 const r=await readDemandMetaAds({...base,fetchImpl:mock({data:[{...row,insights:{data:[{impressions:'12',spend:'5.00'}],paging:{cursors:{after:'cursor'}}}}]})});
 assert.equal(r.impressions,12);
 assert.equal(r.spendMinor,500);
});

// Graph Insights metrics are documented as decimal strings. Coercion would accept
// numbers, booleans and arrays, masking malformed provider responses.
test('reject non-string Meta Insights metrics instead of coercing values',async()=>{
 for(const metrics of [
  {impressions:12,spend:'5.00'},
  {impressions:'12',spend:5},
  {impressions:true,spend:'5.00'},
  {impressions:['12'],spend:'5.00'},
  {impressions:'12',spend:['5.00']}
 ]){
  await assert.rejects(readDemandMetaAds({...base,fetchImpl:mock({data:[{...row,insights:{data:[metrics]}}]})}),/DEMAND_META_READ_UNVERIFIED/);
 }
});

// Unknown provider status must never be displayed as a trusted campaign state.
test('reject unknown or malformed effective_status without coercion',async()=>{
 for(const effective_status of ['UNKNOWN_STATUS','',null,123,{value:'PAUSED'}]){
  await assert.rejects(readDemandMetaAds({...base,fetchImpl:mock({data:[{...row,effective_status}]})}),/DEMAND_META_READ_UNVERIFIED/);
 }
});
test('accept documented non-active Meta effective statuses without declaring ad activation',async()=>{
 for(const effective_status of ['PAUSED','CAMPAIGN_PAUSED','ADSET_PAUSED','WITH_ISSUES','PENDING_REVIEW','IN_PROCESS','PENDING_BILLING_CAMPAIGN','PENDING_BILLING_ADSET']){
  const r=await readDemandMetaAds({...base,fetchImpl:mock({data:[{...row,effective_status}]})});
  assert.equal(r.rows[0].effectiveStatus,effective_status);
  assert.equal(r.metaWriteAllowed,false);
 }
});
