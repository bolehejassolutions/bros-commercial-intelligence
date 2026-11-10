import test from 'node:test';
import assert from 'node:assert/strict';
import {readDemandMetaAdsDiagnosed} from '../lib/demand/meta-readonly-diagnosed.mjs';
const base={tenantId:'tenant-a',authorizedTenantId:'tenant-a',accountId:'1997776120879476',campaignId:'120251158023300697',accessToken:'fixture-value-only',retrievedAt:'2026-11-10T01:00:00.000Z'};
const failure=body=>async(url,opts)=>{assert.equal(opts.method,'GET');assert.equal(new URL(url).searchParams.has('access_token'),false);return {ok:false,json:async()=>body};};
test('rate limit remains failed with retryable safe diagnosis',async()=>{
 const r=await readDemandMetaAdsDiagnosed({...base,fetchImpl:failure({error:{code:613,message:'sensitive fixture'}})});
 assert.equal(r.ok,false);assert.equal(r.snapshot,null);assert.equal(r.diagnosis.state,'RATE_LIMITED');
 assert.equal(r.diagnosis.retryable,true);assert.equal(r.diagnosis.metaWriteAllowed,false);
 assert.ok(!JSON.stringify(r).includes('sensitive fixture'));
});
test('permission and expired credential require owner action without writes',async()=>{
 for(const [code,state] of [[200,'PERMISSION_DENIED'],[190,'TOKEN_INVALID_OR_EXPIRED']]){
  const r=await readDemandMetaAdsDiagnosed({...base,fetchImpl:failure({error:{code}})});
  assert.equal(r.diagnosis.state,state);assert.equal(r.diagnosis.requiresOwnerAction,true);
  assert.equal(r.diagnosis.metaWriteAllowed,false);
 }
});
test('malformed and hostile provider errors remain unverified',async()=>{
 for(const body of [{error:{code:'190'}},{error:{code:9999}},null]){
  const r=await readDemandMetaAdsDiagnosed({...base,fetchImpl:failure(body)});
  assert.equal(r.ok,false);assert.equal(r.diagnosis.state,'PROVIDER_UNVERIFIED');
 }
 const r=await readDemandMetaAdsDiagnosed({...base,fetchImpl:failure({error:new Proxy({}, {getPrototypeOf(){throw Error('hidden')}})})});
 assert.equal(r.diagnosis.state,'PROVIDER_UNVERIFIED');
});
test('tenant denial precedes network and cannot be misclassified',async()=>{
 let calls=0;
 const r=await readDemandMetaAdsDiagnosed({...base,authorizedTenantId:'other',fetchImpl:async()=>{calls++}});
 assert.equal(calls,0);assert.equal(r.ok,false);assert.equal(r.diagnosis.state,'PROVIDER_UNVERIFIED');
});
test('empty successful GET preserves NO_ROWS_NOT_ZERO',async()=>{
 const r=await readDemandMetaAdsDiagnosed({...base,fetchImpl:async()=>({ok:true,json:async()=>({data:[]})})});
 assert.equal(r.ok,true);assert.equal(r.diagnosis,null);
 assert.equal(r.snapshot.state,'NO_ROWS_NOT_ZERO');assert.equal(r.snapshot.spendMinor,null);
});
test('transport exceptions never disclose messages',async()=>{
 const r=await readDemandMetaAdsDiagnosed({...base,fetchImpl:async()=>{throw Error('sensitive fixture')}});
 assert.equal(r.ok,false);assert.equal(r.diagnosis.state,'PROVIDER_UNVERIFIED');
 assert.ok(!JSON.stringify(r).includes('sensitive fixture'));
});

test('Graph error envelope with HTTP 200 is diagnosed and never accepted as a snapshot',async()=>{
 let reads=0;
 const r=await readDemandMetaAdsDiagnosed({...base,fetchImpl:async()=>({ok:true,json:async()=>{reads++;return {error:{code:190,message:'fixture-private-token'}}}})});
 assert.equal(reads,1,'response body must be read once');
 assert.equal(r.ok,false);assert.equal(r.snapshot,null);
 assert.equal(r.diagnosis.state,'TOKEN_INVALID_OR_EXPIRED');
 assert.equal(r.diagnosis.metaWriteAllowed,false);
 assert.ok(!JSON.stringify(r).includes('fixture-private-token'));
});
test('HTTP 200 malformed Graph envelope remains unverified, not an empty success',async()=>{
 const r=await readDemandMetaAdsDiagnosed({...base,fetchImpl:async()=>({ok:true,json:async()=>({error:{code:'190',message:'private'}})})});
 assert.equal(r.ok,false);assert.equal(r.snapshot,null);
 assert.equal(r.diagnosis.state,'PROVIDER_UNVERIFIED');
 assert.ok(!JSON.stringify(r).includes('private'));
});
test('successful Graph snapshot is parsed once and preserves unknown metrics',async()=>{
 let reads=0;
 const r=await readDemandMetaAdsDiagnosed({...base,fetchImpl:async()=>({ok:true,json:async()=>{reads++;return {data:[]}}})});
 assert.equal(reads,1);
 assert.equal(r.ok,true);assert.equal(r.diagnosis,null);
 assert.equal(r.snapshot.state,'NO_ROWS_NOT_ZERO');
 assert.equal(r.snapshot.spendMinor,null);
});
