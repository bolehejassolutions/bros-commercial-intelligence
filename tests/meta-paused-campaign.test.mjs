import test from 'node:test';
import assert from 'node:assert/strict';
import {preparePausedCampaignPlan,pausedCampaignBodies} from '../lib/demand/meta-paused-campaign-plan.ts';
import {createPausedCampaignService} from '../lib/demand/meta-paused-campaign-service.ts';
import {createPausedCampaignHttpHandler} from '../lib/demand/meta-paused-campaign-http.ts';
import {createPilotLedger,PilotReconciliationRequired} from '../lib/demand/meta-pilot-ledger.ts';
import {PILOT} from '../lib/demand/meta-pilot-policy.ts';
const now=Date.parse('2026-11-07T00:00:00.000Z');
const scope={tenantId:'11111111-1111-4111-8111-111111111111',principalId:'22222222-2222-4222-8222-222222222222'};
const draft=()=>({name:'BROS SELL reviewed test',budgetMinor:14000,durationDays:7,startTime:'2026-11-07T02:00:00.000Z',
  landingUrl:'https://bros.bolehejas.com/?utm_source=facebook&utm_medium=paid_social&utm_campaign=test',
  primaryText:'Synthetic education copy, not a real approved advert.',headline:'Understand the next step',description:'Synthetic fixture',imageHash:'a'.repeat(32)});
const identities={universal_beneficiary:'99999999000001',universal_payer:'99999999000002'};
function fixture(disabled=false){
  const env={META_APP_ID:'1315572270590189',META_APP_SECRET:'synthetic-app-secret-value',META_ADS_MANAGEMENT_TOKEN:'synthetic-management-token-value',
    BROS_DEMAND_META_PAUSED_CREATE:disabled?undefined:'operator-approved-v1',BROS_DEMAND_META_CREATOR_LEDGER:'reviewed-v1'};
  const calls=[],objects=new Map(),ledgers=new Map();let counter=0,corrupt=false;
  const account={id:PILOT.account,account_id:PILOT.account.slice(4),account_status:1,currency:'MYR',timezone_name:'Asia/Kuala_Lumpur',
    business:{id:'2091328444802994'},user_tasks:['ADVERTISE']};
  const transport=async(input,init={})=>{
    const u=new URL(String(input));calls.push({url:u,init});assert.equal(u.origin,'https://graph.facebook.com');assert.equal(init.redirect,'error');
    const path=u.pathname.split('/').filter(Boolean).slice(1);let data;
    if(init.method==='POST'){
      assert.equal(path[0],PILOT.account);assert.ok(['campaigns','adsets','adcreatives','ads'].includes(path[1]));
      const form=new URLSearchParams(init.body),r=Object.fromEntries(form);
      for(const key of ['special_ad_categories','targeting','promoted_object','regional_regulated_categories','regional_regulation_identities','object_story_spec','creative'])
        if(key in r)r[key]=JSON.parse(r[key]);
      const id='9000000000'+String(++counter).padStart(4,'0');
      if(path[1]!=='adcreatives')assert.equal(r.status,'PAUSED');
      if(path[1]==='ads'){r.campaign_id=objects.get(r.adset_id).campaign_id;r.creative={id:r.creative.creative_id};}
      if(corrupt&&path[1]==='campaigns')r.status='ACTIVE';
      objects.set(id,{...r,id,account_id:PILOT.account.slice(4)});data={id};
    }else if(path[0]==='debug_token')data={data:{app_id:env.META_APP_ID,is_valid:true,expires_at:Math.floor(now/1000)+86400,data_access_expires_at:0,scopes:['ads_management']}};
    else if(path[0]===env.META_APP_ID)data={id:env.META_APP_ID,name:'BROS Commercial Intelligence'};
    else if(path[1]==='owned_apps')data={data:[{id:env.META_APP_ID}]};
    else if(path[0]===PILOT.account&&path.length===1)data=account;
    else if(path[0]===PILOT.account&&path[1]==='adimages')data={data:[{hash:'a'.repeat(32),name:'Synthetic existing account image'}]};
    else if(path[0]==='120251321765170697')data={id:path[0],account_id:account.account_id,campaign_id:PILOT.campaign,
      regional_regulated_categories:['MALAYSIA_UNIVERSAL'],regional_regulation_identities:identities};
    else if(objects.has(path[0]))data=objects.get(path[0]);else throw Error('Unexpected fixture request');
    return Response.json(data);
  };
  const ledger=(_scope,sha)=>{
    if(!ledgers.has(sha)){const snapshot={},pending=new Set();ledgers.set(sha,{snapshot:async()=>{
      if(pending.size)throw new PilotReconciliationRequired();return structuredClone(snapshot);},perform:async(step,fn)=>{
        if(snapshot[step])return snapshot[step];if(pending.has(step))throw new PilotReconciliationRequired();pending.add(step);
        try{const r=await fn();snapshot[step]=r;pending.delete(step);return r;}catch(cause){const error=new PilotReconciliationRequired();error.cause=cause;throw error;}}});}
    return ledgers.get(sha);
  };
  const service=createPausedCampaignService({environment:env,ledger,reauthorize:async()=>{},now:()=>now,transport});
  return {service,env,calls,objects,ledger,transport,corrupt:()=>{corrupt=true;}};
}
test('plan binds exact input and scope; budget, host and caller authority injection deny',()=>{
  const p=preparePausedCampaignPlan(scope,draft(),14000,now);
  assert.equal(preparePausedCampaignPlan(scope,draft(),14000,now).planSha256,p.planSha256);
  assert.notEqual(preparePausedCampaignPlan({...scope,tenantId:scope.principalId},draft(),14000,now).planSha256,p.planSha256);
  for(const change of [{budgetMinor:14001},{landingUrl:'https://foreign.example/'},{status:'ACTIVE'},{durationDays:8},
    {startTime:'2026-11-07T00:05:00.000Z'},{imageHash:'bad'}])assert.throws(()=>preparePausedCampaignPlan(scope,{...draft(),...change},14000,now));
  const bodies=pausedCampaignBodies(p,identities);assert.equal(bodies.campaign.status,'PAUSED');assert.equal(bodies.campaign.lifetime_budget,14000);
  assert.equal(bodies.adset('90000000000001').lifetime_budget,undefined);
});
test('actual service creates campaign, adset, creative and ad PAUSED with readback; exact replay makes zero extra POSTs (MOCK Meta/ledger)',async()=>{
  const f=fixture(),review=await f.service.preview(scope,draft());assert.equal(review.canCreate,true);
  assert.equal(f.calls.filter(x=>x.init.method==='POST').length,0);
  let result;for(let i=0;i<4;i++)result=await f.service.stage(scope,draft(),review.plan.planSha256,'CREATE_PAUSED_ONLY');
  assert.equal(result.status,'CREATED_PAUSED_VERIFIED');assert.equal(result.activationAvailable,false);assert.equal(result.spendAuthorized,false);
  assert.equal(Object.keys(result.objects).length,4);assert.ok(!Object.values(result.objects).includes(PILOT.campaign));
  await f.service.stage(scope,draft(),review.plan.planSha256,'CREATE_PAUSED_ONLY');
  assert.equal(f.calls.filter(x=>x.init.method==='POST').length,4);
  assert.ok(f.calls.filter(x=>x.init.method==='POST').every(x=>x.url.pathname.includes('/'+PILOT.account+'/')));
});
test('wrong reviewed hash, missing explicit authority and disabled gate cannot issue any Meta POST',async()=>{
  for(const variant of ['hash','authority','disabled']){
    const f=fixture(variant==='disabled'),p=preparePausedCampaignPlan(scope,draft(),14000,now);
    await assert.rejects(f.service.stage(scope,draft(),variant==='hash'?'0'.repeat(64):p.planSha256,
      variant==='authority'?'APPROVE_ACTIVE':'CREATE_PAUSED_ONLY'));
    assert.equal(f.calls.filter(x=>x.init.method==='POST').length,0);
  }
});
test('ambiguous provider result keeps durable intent and blocks automatic duplicate creation',async()=>{
  const f=fixture(),p=preparePausedCampaignPlan(scope,draft(),14000,now);f.corrupt();
  await assert.rejects(f.service.stage(scope,draft(),p.planSha256,'CREATE_PAUSED_ONLY'),PilotReconciliationRequired);
  await assert.rejects(f.service.stage(scope,draft(),p.planSha256,'CREATE_PAUSED_ONLY'),PilotReconciliationRequired);
  assert.equal(f.calls.filter(x=>x.init.method==='POST').length,1);
});
test('same-origin authenticated HTTP requires unchanged plan approval; CSRF and tenant injection reject',async()=>{
  const f=fixture(),handle=createPausedCampaignHttpHandler({enabled:()=>true,authorize:async()=>scope,service:()=>f.service});
  const origin='https://demand.example.test';
  const req=(payload,extra={})=>new Request(origin+'/api/internal/demand-meta-campaigns',{method:'POST',
    headers:{origin,'content-type':'application/json',authorization:'Bearer a.b.c',...extra},body:JSON.stringify(payload)});
  assert.equal((await handle(req({action:'preview',draft:draft()}))).status,200);
  assert.equal((await handle(req({action:'preview',draft:draft(),tenantId:scope.tenantId}))).status,400);
  assert.equal((await handle(req({action:'preview',draft:draft()},{origin:'https://foreign.example'}))).status,403);
  assert.equal((await handle(req({action:'create_paused',draft:draft(),planSha256:'0'.repeat(64),authorization:'ACTIVE'}))).status,400);
  assert.equal(f.calls.filter(x=>x.init.method==='POST').length,0);
});
test('real journal adapter isolates new plan namespace and denies activation steps before SQL',async()=>{
  const calls=[];const tx=async fn=>fn(async(sql,p)=>{calls.push({sql,p});
    if(sql.includes('current_user AS role_name'))return {rows:[{role_name:'bci_dev_evidence_writer_restricted',session_role:'bci_dev_evidence_writer_restricted',
      database_name:'bros_intelligence_dev',rolsuper:false,rolbypassrls:false,rolcanlogin:true,rolcreaterole:false,rolcreatedb:false,parents:0}]};
    if(sql.includes('AS forced_rls'))return {rows:[{forced_rls:true,can_read:true,can_append:true,can_mutate:false,owns_table:false}]};
    if(sql.includes('SELECT principal_id'))return {rows:[{principal_id:scope.principalId}]};return {rows:[]};});
  const ledger=createPilotLedger(tx,scope,{pausedCampaignPlanSha256:'c'.repeat(64)});await ledger.snapshot();
  assert.ok(calls.some(x=>x.p.includes('bros-demand-paused-v1:'+'c'.repeat(64))));
  const count=calls.length;await assert.rejects(ledger.perform('activate_campaign',async()=>assert.fail()));assert.equal(calls.length,count);
  await assert.rejects(ledger.revoke());
});
