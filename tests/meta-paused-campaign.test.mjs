import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {preparePausedCampaignPlan,restorePausedCampaignPlan,pausedCampaignBodies} from '../lib/demand/meta-paused-campaign-plan.ts';
import {createPausedCampaignService} from '../lib/demand/meta-paused-campaign-service.ts';
import {createPausedCampaignHttpHandler} from '../lib/demand/meta-paused-campaign-http.ts';
import {createPilotLedger,PilotReconciliationRequired} from '../lib/demand/meta-pilot-ledger.ts';
import {PILOT} from '../lib/demand/meta-pilot-policy.ts';
import {creativeRetryNamespace,sealCreativeRecovery,verifyCreativeRecovery} from '../lib/demand/meta-paused-recovery-receipt.ts';
import {createDemandCreativeAdmission} from '../lib/demand/creative-admission.ts';
import {bindDemandCreativeForReview} from '../lib/demand/creative-plan-binding.ts';
const now=Date.parse('2026-11-07T00:00:00.000Z');
const scope={tenantId:'11111111-1111-4111-8111-111111111111',principalId:'22222222-2222-4222-8222-222222222222'};
const draft=()=>({name:'BROS SELL reviewed test',budgetMinor:14000,durationDays:7,startTime:'2026-11-07T02:00:00.000Z',
  landingUrl:'https://bros.bolehejas.com/?utm_source=facebook&utm_medium=paid_social&utm_campaign=test',
  primaryText:'Synthetic education copy, not a real approved advert.',headline:'Understand the next step',description:'Synthetic fixture',imageHash:'a'.repeat(32)});
const identities={universal_beneficiary:'99999999000001',universal_payer:'99999999000002'};
const creativeBytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==','base64');
const creativeRecord={
  tenantId:scope.tenantId,assetId:'asset:immutable:001',creativeVersion:'version:001',
  brandInstanceId:'brand:bros_sell',presetId:'preset:natural_my_ugc',presetVersion:'preset:v1',
  sha256:createHash('sha256').update(creativeBytes).digest('hex'),bytes:creativeBytes.length,mime:'image/png',
  mediaQa:'PASSED',editorialQa:'APPROVED',status:'APPROVED',logoEvidence:'OFFICIAL_APPROVED',
  claimsEvidence:'NO_CLAIMS',aiDisclosure:'REVIEWED',approvalEvidenceId:'approval:editorial:001',
};
async function verifyMockCreativePlan(tenantScope,plan){
  const approvedPlan=preparePausedCampaignPlan(scope,draft(),14000,now);
  if(tenantScope.tenantId!==scope.tenantId||tenantScope.principalId!==scope.principalId||
     plan.planSha256!==approvedPlan.planSha256)return null;
  const intake=await createDemandCreativeAdmission({
    authenticate:async()=>({userId:scope.principalId,authenticated:true}),
    membershipsFor:async()=>[{tenantId:scope.tenantId,principalId:scope.principalId,product:'demand',active:true}],
    approvedRecordFor:async()=>creativeRecord,mediaFor:async()=>creativeBytes,
    verifyApproval:async({tenantId,assetId,creativeVersion,brandInstanceId,sha256,approvalEvidenceId})=>({
      tenantId,product:'demand',purpose:'CREATIVE_REVIEW',assetId,creativeVersion,brandInstanceId,
      mediaSha256:sha256,approvalEvidenceId,logoAssetVersionId:'logo:approved:001',
    }),
  })({assetId:creativeRecord.assetId,creativeVersion:creativeRecord.creativeVersion});
  const {accountId,imageHash,planSha256}=approvedPlan;
  return {intake,accountId,imageHash,planSha256,reviewDigest:bindDemandCreativeForReview(intake,{
    tenantId:scope.tenantId,accountId,campaignPlanDigest:planSha256,
  }).digest};
}
function fixture(disabled=false, approval=preparePausedCampaignPlan(scope,draft(),14000,now).planSha256, beforeCreate=async()=>{}){
  const env={META_APP_ID:'1315572270590189',META_APP_SECRET:'synthetic-app-secret-value',META_ADS_MANAGEMENT_TOKEN:'synthetic-management-token-value',
    BROS_DEMAND_META_PAUSED_CREATE:disabled?undefined:'operator-approved-v1',BROS_DEMAND_META_CREATOR_LEDGER:'reviewed-v1',
    BROS_DEMAND_META_PAUSED_APPROVED_PLAN_SHA256:approval??undefined};
  const calls=[],objects=new Map(),ledgers=new Map();let counter=0,corrupt=false,failCreativeReadback=false,validationAllowed=false,denyCreativePost=false,clock=now;
  const account={id:PILOT.account,account_id:PILOT.account.slice(4),account_status:1,currency:'MYR',timezone_name:'Asia/Kuala_Lumpur',
    business:{id:'2091328444802994'},user_tasks:['ADVERTISE']};
  const transport=async(input,init={})=>{
    const u=new URL(String(input));calls.push({url:u,init});assert.equal(u.origin,'https://graph.facebook.com');assert.equal(init.redirect,'error');
    const path=u.pathname.split('/').filter(Boolean).slice(1);let data;
    if(init.method==='POST'){
      assert.equal(path[0],PILOT.account);assert.ok(['campaigns','adsets','adcreatives','ads'].includes(path[1]));
      const form=new URLSearchParams(init.body),r=Object.fromEntries(form);
      if(form.has('execution_options')){assert.equal(path[1],'adcreatives');assert.deepEqual(JSON.parse(form.get('execution_options')),['validate_only']);
        if(validationAllowed)return Response.json({success:true});
        return Response.json({error:{code:100,error_subcode:1885183,message:'Synthetic validation rejection',
          error_user_title:'Synthetic title',error_user_msg:'Synthetic reason '+env.META_ADS_MANAGEMENT_TOKEN}},{status:400});}
      await beforeCreate();
      if(path[1]==='adcreatives'&&denyCreativePost)return Response.json({error:{code:100,error_subcode:1885183}},{status:400});
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
    else if(path[1]==='adcreatives')data={data:[...objects.values()].filter(x=>x.object_story_spec)};
    else if(path[1]==='ads')data={data:[...objects.values()].filter(x=>x.adset_id===path[0])};
    else if(objects.has(path[0])){data=objects.get(path[0]);if(failCreativeReadback&&data.object_story_spec){failCreativeReadback=false;throw Error('Synthetic readback interruption after accepted POST');}}
    else throw Error('Unexpected fixture request');
    return Response.json(data);
  };
  const ledger=(_scope,sha)=>{
    if(!ledgers.has(sha)){const snapshot={},pending=new Set();ledgers.set(sha,{snapshot:async()=>{
      if(pending.size)throw new PilotReconciliationRequired();return structuredClone(snapshot);},
      recoveryState:async()=>({confirmed:structuredClone(snapshot),pending:[...pending]}),
      confirmRecovered:async(step,id,verify)=>{assert.ok(pending.has(step));await verify();snapshot[step]={id};pending.delete(step);return {id};},perform:async(step,fn)=>{
        if(snapshot[step])return snapshot[step];if(pending.has(step))throw new PilotReconciliationRequired();pending.add(step);
        try{const r=await fn();snapshot[step]=r;pending.delete(step);return r;}catch(cause){const error=new PilotReconciliationRequired();error.cause=cause;throw error;}}});}
    return ledgers.get(sha);
  };
  const makeService=(environment=env,verifyCreativeForPlan=verifyMockCreativePlan)=>createPausedCampaignService({
    environment,ledger,reauthorize:async()=>{},now:()=>clock,transport,verifyCreativeForPlan:verifyCreativeForPlan??undefined,
  });
  return {service:makeService(),makeService,env,calls,objects,ledger,ledgers,transport,corrupt:()=>{corrupt=true;},interruptCreative:()=>{failCreativeReadback=true;},
    rejectCreative:()=>{denyCreativePost=true;},allowValidation:()=>{validationAllowed=true;denyCreativePost=false;},advance:ms=>{clock+=ms;}};
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
test('server approval defaults OFF and binds to a single exact tenant and campaign plan', async () => {
  const plan = preparePausedCampaignPlan(scope, draft(), 14000, now);
  const changedDraft = { ...draft(), headline: 'A different reviewed headline' };
  const changedPlan = preparePausedCampaignPlan(scope, changedDraft, 14000, now);
  const otherScope = { ...scope, tenantId: scope.principalId };
  const otherPlan = preparePausedCampaignPlan(otherScope, draft(), 14000, now);
  const disabled = fixture(false, null);
  const approved = fixture();

  for (const [f, tenantScope, input, hash] of [
    [disabled, scope, draft(), plan.planSha256],
    [approved, scope, changedDraft, changedPlan.planSha256],
    [approved, otherScope, draft(), otherPlan.planSha256],
  ]) {
    await assert.rejects(f.service.stage(tenantScope, input, hash, 'CREATE_PAUSED_ONLY'), /OWNER_APPROVAL_REQUIRED/);
    assert.equal(f.calls.length, 0);
    assert.equal(f.ledgers.size, 0);
  }

  const preview = await disabled.service.preview(scope, draft());
  assert.equal(preview.canCreate, false);
  assert.ok(preview.blockers.includes('PAUSED_PLAN_OWNER_APPROVAL_REQUIRED'));
  assert.ok(disabled.calls.every(call => call.init.method === 'GET'));
});
test('exact owner approval still requires authoritative original creative, copy and account image binding', async () => {
  const p=preparePausedCampaignPlan(scope,draft(),14000,now);
  const valid=await verifyMockCreativePlan(scope,p);
  for(const verifier of [null,async()=>null,async()=>{throw Error('private asset service unavailable');},
    async()=>({...valid,planSha256:'0'.repeat(64)}),async()=>({...valid,accountId:'act_123456'}),
    async()=>({...valid,imageHash:'c'.repeat(32)}),async()=>({...valid,reviewDigest:'d'.repeat(64)}),
    async()=>({...valid,intake:{...valid.intake}})]){
    const f=fixture(),service=f.makeService(f.env,verifier);
    const preview=await service.preview(scope,draft());
    assert.ok(preview.blockers.includes('PAUSED_CREATIVE_EVIDENCE_REQUIRED'));
    assert.equal(preview.canCreate,false);
    await assert.rejects(service.stage(scope,draft(),p.planSha256,'CREATE_PAUSED_ONLY'),/CREATIVE_EVIDENCE_REQUIRED/);
    assert.deepEqual(await f.ledger(scope,p.planSha256).recoveryState(),{confirmed:{},pending:[]});
    assert.ok(f.calls.every(call=>call.init.method==='GET'));
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
async function interruptedCreative(){
  const f=fixture(),p=preparePausedCampaignPlan(scope,draft(),14000,now);
  await f.service.stage(scope,draft(),p.planSha256,'CREATE_PAUSED_ONLY');
  await f.service.stage(scope,draft(),p.planSha256,'CREATE_PAUSED_ONLY');f.interruptCreative();
  await assert.rejects(f.service.stage(scope,draft(),p.planSha256,'CREATE_PAUSED_ONLY'),PilotReconciliationRequired);
  return {f,p};
}
test('interrupted creative POST reconciles exact provider object with GETs only, preserves intent and finishes without duplicate creation (MOCK)',async()=>{
  const {f,p}=await interruptedCreative();assert.equal(f.calls.filter(x=>x.init.method==='POST').length,3);
  const recovered=await f.service.reconcile(scope,draft(),p.planSha256,'RECONCILE_PAUSED_ONLY');
  assert.equal(recovered.status,'RECOVERED_PAUSED');assert.equal(recovered.canContinue,true);
  assert.equal(f.calls.filter(x=>x.init.method==='POST').length,3);
  const done=await f.service.stage(scope,draft(),p.planSha256,'CREATE_PAUSED_ONLY');assert.equal(done.status,'CREATED_PAUSED_VERIFIED');
  assert.equal((await f.service.reconcile(scope,draft(),p.planSha256,'RECONCILE_PAUSED_ONLY')).status,'CREATED_PAUSED_VERIFIED');
  assert.equal(f.calls.filter(x=>x.init.method==='POST').length,4);
});
test('missing, mismatched or duplicate recovery candidates leave intent blocked and issue no Meta POST (MOCK)',async()=>{
  for(const kind of ['missing','mismatch','duplicate']){
    const {f,p}=await interruptedCreative(),entry=[...f.objects.entries()].find(([,v])=>v.object_story_spec);
    if(kind==='missing')f.objects.delete(entry[0]);
    if(kind==='mismatch')entry[1].object_story_spec.link_data.link='https://foreign.example/';
    if(kind==='duplicate')f.objects.set('90000000009999',{...structuredClone(entry[1]),id:'90000000009999'});
    const r=await f.service.reconcile(scope,draft(),p.planSha256,'RECONCILE_PAUSED_ONLY');
    assert.equal(r.status,'RECOVERY_HELD');assert.equal(r.canContinue,false);
    assert.equal(r.discovery.status,{missing:'NO_MATCH',mismatch:'READBACK_MISMATCH',duplicate:'AMBIGUOUS'}[kind]);
    await assert.rejects(f.service.stage(scope,draft(),p.planSha256,'CREATE_PAUSED_ONLY'),PilotReconciliationRequired);
    assert.equal(f.calls.filter(x=>x.init.method==='POST'&&!new URLSearchParams(x.init.body).has('execution_options')).length,3);
    if(kind==='missing'){assert.equal(r.discovery.validation.mode,'VALIDATE_ONLY');assert.equal(r.discovery.validation.code,100);assert.equal(r.discovery.validation.accepted,false);
      assert.equal(r.discovery.validation.userTitle,'Synthetic title');assert.equal(r.discovery.validation.userMessage,'Synthetic reason [redacted]');}
  }
});
test('recovery requires exact scope-bound hash and separate explicit authority before any provider request',async()=>{
  const f=fixture(),p=preparePausedCampaignPlan(scope,draft(),14000,now);
  await assert.rejects(f.service.reconcile(scope,draft(),p.planSha256,'CREATE_PAUSED_ONLY'));
  await assert.rejects(f.service.reconcile({...scope,principalId:scope.tenantId},draft(),p.planSha256,'RECONCILE_PAUSED_ONLY'));
  assert.equal(f.calls.length,0);
});
async function rejectedCreative(){
  const f=fixture(),p=preparePausedCampaignPlan(scope,draft(),14000,now);
  await f.service.stage(scope,draft(),p.planSha256,'CREATE_PAUSED_ONLY');
  await f.service.stage(scope,draft(),p.planSha256,'CREATE_PAUSED_ONLY');f.rejectCreative();
  await assert.rejects(f.service.stage(scope,draft(),p.planSha256,'CREATE_PAUSED_ONLY'),PilotReconciliationRequired);
  const readback=await f.service.reconcile(scope,draft(),p.planSha256,'RECONCILE_PAUSED_ONLY');
  assert.equal(readback.discovery.status,'NO_MATCH');assert.ok(readback.recoveryReceipt);
  return {f,p,receipt:readback.recoveryReceipt};
}
const creationPosts=f=>f.calls.filter(x=>x.init.method==='POST'&&!new URLSearchParams(x.init.body).has('execution_options')).length;
test('revoked owner approval keeps historical reconciliation GET-only and blocks a sealed retry', async () => {
  const { f, p, receipt } = await rejectedCreative();
  const disabled = f.makeService({ ...f.env, BROS_DEMAND_META_PAUSED_APPROVED_PLAN_SHA256: undefined });
  const before = f.calls.length;
  const held = await disabled.reconcile(scope, draft(), p.planSha256, 'RECONCILE_PAUSED_ONLY');
  assert.equal(held.status, 'RECOVERY_HELD');
  assert.equal(held.discovery.status, 'NO_MATCH');
  assert.equal(held.discovery.validation, undefined);
  assert.equal(held.recoveryReceipt, undefined);
  const readback = f.calls.slice(before);
  assert.ok(readback.length > 0);
  assert.ok(readback.every(call => call.init.method === 'GET'));
  await assert.rejects(disabled.retryCreative(scope, draft(), p.planSha256, receipt, 'RETRY_RECONCILED_PAUSED_CREATIVE'),
    /OWNER_APPROVAL_REQUIRED/);
  assert.equal(f.calls.length, before + readback.length);
});

test('complete historical PAUSED records still verify without current execution approval', async () => {
  const f = fixture(), p = preparePausedCampaignPlan(scope, draft(), 14000, now);
  for (let step = 0; step < 4; step++) await f.service.stage(scope, draft(), p.planSha256, 'CREATE_PAUSED_ONLY');
  const disabled = f.makeService({ ...f.env, BROS_DEMAND_META_PAUSED_APPROVED_PLAN_SHA256: undefined }, null);
  const before = f.calls.length;
  const readback = await disabled.reconcile(scope, draft(), p.planSha256, 'RECONCILE_PAUSED_ONLY');
  assert.equal(readback.status, 'CREATED_PAUSED_VERIFIED');
  assert.equal(readback.canContinue, false);
  assert.equal(Object.keys(readback.objects).length, 4);
  assert.ok(f.calls.slice(before).every(call => call.init.method === 'GET'));
  assert.equal(creationPosts(f), 4);
});

test('missing current creative evidence leaves recovery GET-only and disables a previously sealed retry', async () => {
  const {f,p,receipt}=await rejectedCreative();
  const service=f.makeService(f.env,null),before=f.calls.length;
  const readback=await service.reconcile(scope,draft(),p.planSha256,'RECONCILE_PAUSED_ONLY');
  assert.equal(readback.status,'RECOVERY_HELD');
  assert.equal(readback.discovery.status,'NO_MATCH');
  assert.equal(readback.discovery.validation,undefined);
  assert.equal(readback.recoveryReceipt,undefined);
  assert.ok(f.calls.slice(before).every(call=>call.init.method==='GET'));
  const beforeRetry=f.calls.length;
  await assert.rejects(service.retryCreative(scope,draft(),p.planSha256,receipt,'RETRY_RECONCILED_PAUSED_CREATIVE'),
    /CREATIVE_EVIDENCE_REQUIRED/);
  assert.equal(f.calls.length,beforeRetry);
});

test('creative proof revoked during recovery validation blocks the retry before intent or creation', async () => {
  const {f,p,receipt}=await rejectedCreative();
  f.allowValidation();
  const before=f.calls.length;
  const service=f.makeService(f.env,async(tenantScope,plan)=>{
    const validated=f.calls.slice(before).some(call=>call.init.method==='POST'&&
      new URLSearchParams(call.init.body).has('execution_options'));
    return validated?null:verifyMockCreativePlan(tenantScope,plan);
  });
  await assert.rejects(service.retryCreative(scope,draft(),p.planSha256,receipt,'RETRY_RECONCILED_PAUSED_CREATIVE'),
    /CREATIVE_EVIDENCE_REQUIRED/);
  const posts=f.calls.slice(before).filter(call=>call.init.method==='POST');
  assert.equal(posts.length,1);
  assert.ok(new URLSearchParams(posts[0].init.body).has('execution_options'));
  assert.deepEqual(await f.ledger(scope,creativeRetryNamespace(p.planSha256)).recoveryState(),{confirmed:{},pending:[]});
});

test('concurrent submissions of one approved plan issue at most one initial provider POST', async () => {
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const p = preparePausedCampaignPlan(scope, draft(), 14000, now);
  const f = fixture(false, p.planSha256, () => { entered.resolve(); return release.promise; });
  const submit = () => f.service.stage(scope, draft(), p.planSha256, 'CREATE_PAUSED_ONLY');
  const first = submit();
  try {
    await Promise.race([entered.promise, first]);
    await assert.rejects(submit(), PilotReconciliationRequired);
  } finally {
    release.resolve();
  }
  assert.equal((await first).completedSteps, 1);
  assert.equal(creationPosts(f), 1);
  assert.equal(f.objects.size, 1);
});

test('machine recovery receipt is scoped, authenticated, short-lived and cannot become human/activation authority',()=>{
  const sha='d'.repeat(64),secret='synthetic-private-server-key',r=sealCreativeRecovery(scope,sha,secret,now);
  verifyCreativeRecovery(scope,sha,r,secret,now+1000);
  for(const change of [()=>verifyCreativeRecovery({...scope,tenantId:scope.principalId},sha,r,secret,now),
    ()=>verifyCreativeRecovery(scope,'e'.repeat(64),r,secret,now),()=>verifyCreativeRecovery(scope,sha,r+'.x',secret,now),
    ()=>verifyCreativeRecovery(scope,sha,r,secret,now+45*60000),()=>verifyCreativeRecovery(scope,sha,r,'another-private-server-key',now)])assert.throws(change);
  assert.notEqual(creativeRetryNamespace(sha),sha);assert.equal(creativeRetryNamespace(sha),creativeRetryNamespace(sha));
});
test('same approved plan retries the rejected creative only after fresh validation passes; durable recovery namespace prevents duplicates (MOCK)',async()=>{
  const {f,p,receipt}=await rejectedCreative(),before=creationPosts(f);
  const held=await f.service.retryCreative(scope,draft(),p.planSha256,receipt,'RETRY_RECONCILED_PAUSED_CREATIVE');
  assert.equal(held.status,'RECOVERY_HELD');assert.equal(creationPosts(f),before);
  f.allowValidation();const r=await f.service.retryCreative(scope,draft(),p.planSha256,receipt,'RETRY_RECONCILED_PAUSED_CREATIVE');
  assert.equal(r.status,'RECOVERED_PAUSED');assert.equal(r.canContinue,true);assert.equal(creationPosts(f),before+1);
  await f.service.retryCreative(scope,draft(),p.planSha256,receipt,'RETRY_RECONCILED_PAUSED_CREATIVE');assert.equal(creationPosts(f),before+1);
  const done=await f.service.stage(scope,draft(),p.planSha256,'CREATE_PAUSED_ONLY');assert.equal(done.status,'CREATED_PAUSED_VERIFIED');
  assert.equal(f.objects.size,4);assert.equal(creationPosts(f),before+2);
});
test('uncertain recovery POST blocks another retry and can reconcile the one exact accepted object without new creation (MOCK)',async()=>{
  const {f,p,receipt}=await rejectedCreative();f.allowValidation();f.interruptCreative();const before=creationPosts(f);
  await assert.rejects(f.service.retryCreative(scope,draft(),p.planSha256,receipt,'RETRY_RECONCILED_PAUSED_CREATIVE'),PilotReconciliationRequired);
  await assert.rejects(f.service.retryCreative(scope,draft(),p.planSha256,receipt,'RETRY_RECONCILED_PAUSED_CREATIVE'),PilotReconciliationRequired);
  assert.equal(creationPosts(f),before+1);
  const r=await f.service.reconcile(scope,draft(),p.planSha256,'RECONCILE_PAUSED_ONLY');assert.equal(r.status,'RECOVERED_PAUSED');
  assert.equal(creationPosts(f),before+1);
});
test('restoring a started plan preserves its exact digest without admitting a new past-start campaign',()=>{
  const p=preparePausedCampaignPlan(scope,draft(),14000,now),later=now+3*3600000;
  assert.throws(()=>preparePausedCampaignPlan(scope,draft(),14000,later));
  const restored=restorePausedCampaignPlan(scope,draft(),14000,later);
  assert.deepEqual(restored,p);
  assert.throws(()=>restorePausedCampaignPlan(scope,draft(),14000,now+8*86400000));
});
test('untracked or campaign-only past-start plans cannot reach Meta or create another parent (MOCK)',async()=>{
  for(const partial of [false,true]){
    const f=fixture(),p=preparePausedCampaignPlan(scope,draft(),14000,now);
    if(partial)await f.service.stage(scope,draft(),p.planSha256,'CREATE_PAUSED_ONLY');
    f.advance(3*3600000);const before=f.calls.length;
    await assert.rejects(f.service.preview(scope,draft()));
    await assert.rejects(f.service.reconcile(scope,draft(),p.planSha256,'RECONCILE_PAUSED_ONLY'));
    await assert.rejects(f.service.stage(scope,draft(),p.planSha256,'CREATE_PAUSED_ONLY'));
    assert.equal(f.calls.length,before);
  }
});
test('after app publication and receipt expiry, the same started PAUSED plan can renew proof and finish without new parents (MOCK)',async()=>{
  const {f,p,receipt}=await rejectedCreative(),before=creationPosts(f);f.advance(3*3600000);
  await assert.rejects(f.service.retryCreative(scope,draft(),p.planSha256,receipt,'RETRY_RECONCILED_PAUSED_CREATIVE'));
  f.allowValidation();const review=await f.service.preview(scope,draft());
  assert.equal(review.plan.planSha256,p.planSha256);assert.equal(review.providerVerified,true);
  const renewed=await f.service.reconcile(scope,draft(),p.planSha256,'RECONCILE_PAUSED_ONLY');
  assert.equal(renewed.discovery.status,'NO_MATCH');assert.equal(renewed.discovery.validation.accepted,true);
  assert.ok(renewed.recoveryReceipt);assert.notEqual(renewed.recoveryReceipt,receipt);
  assert.equal(creationPosts(f),before);
  verifyCreativeRecovery(scope,p.planSha256,renewed.recoveryReceipt,f.env.META_APP_SECRET,now+3*3600000);
  const recovered=await f.service.retryCreative(scope,draft(),p.planSha256,renewed.recoveryReceipt,'RETRY_RECONCILED_PAUSED_CREATIVE');
  const done=await f.service.stage(scope,draft(),p.planSha256,'CREATE_PAUSED_ONLY');
  assert.equal(done.status,'CREATED_PAUSED_VERIFIED');assert.equal(creationPosts(f),before+2);
  assert.equal(done.objects.campaign,recovered.objects.campaign);assert.equal(done.objects.adset,recovered.objects.adset);
  assert.equal(f.objects.size,4);
  for(const path of ['campaigns','adsets'])assert.equal(f.calls.filter(x=>x.init.method==='POST'&&x.url.pathname.endsWith('/'+path)).length,1);
});
test('a modified plan or non-PAUSED recorded parent cannot use started-plan recovery (MOCK)',async()=>{
  const {f,p}=await rejectedCreative();f.advance(3*3600000);f.allowValidation();const count=f.calls.length;
  await assert.rejects(f.service.preview(scope,{...draft(),budgetMinor:13999}));assert.equal(f.calls.length,count);
  const campaign=[...f.objects.values()].find(x=>x.objective==='OUTCOME_SALES');campaign.status='ACTIVE';
  const before=creationPosts(f);
  await assert.rejects(f.service.reconcile(scope,draft(),p.planSha256,'RECONCILE_PAUSED_ONLY'));
  assert.equal(creationPosts(f),before);
});
test('ended parent window cannot renew proof or submit another creative (MOCK)',async()=>{
  const {f,p}=await rejectedCreative();f.advance(8*86400000);const before=f.calls.length;
  await assert.rejects(f.service.reconcile(scope,draft(),p.planSha256,'RECONCILE_PAUSED_ONLY'));
  await assert.rejects(f.service.stage(scope,draft(),p.planSha256,'CREATE_PAUSED_ONLY'));
  assert.equal(f.calls.length,before);
});
test('renewed proof cannot bypass an already-uncertain single recovery attempt (MOCK)',async()=>{
  const {f,p,receipt}=await rejectedCreative();f.allowValidation();f.rejectCreative();const before=creationPosts(f);
  await assert.rejects(f.service.retryCreative(scope,draft(),p.planSha256,receipt,'RETRY_RECONCILED_PAUSED_CREATIVE'),PilotReconciliationRequired);
  f.advance(1000);const renewed=await f.service.reconcile(scope,draft(),p.planSha256,'RECONCILE_PAUSED_ONLY');
  assert.equal(renewed.discovery.validation.accepted,true);assert.ok(renewed.recoveryReceipt);
  await assert.rejects(f.service.retryCreative(scope,draft(),p.planSha256,renewed.recoveryReceipt,'RETRY_RECONCILED_PAUSED_CREATIVE'),PilotReconciliationRequired);
  assert.equal(creationPosts(f),before+1);
});
