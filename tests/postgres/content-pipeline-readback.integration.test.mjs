/**
 * End-to-end backend contract on an ephemeral PostgreSQL 16 service.
 *
 * Fake deterministic model only: zero AI/provider requests, paid calls,
 * content publication, credit settlement, and production connections.
 * Verifies the CURRENT private reader alongside the isolated future writer.
 */
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {createContentTransaction} from '../../lib/content/neon-content-transaction.ts';
import {createContentCampaignPlanner} from '../../lib/content/neon-content-generation-orchestrator.ts';
import {createContentGeneratedOutputWriter} from '../../lib/content/neon-content-generated-output-writer.ts';
import {createContentWorkspaceReader,ContentReadDenied} from '../../lib/content/neon-content-workspace-reader.ts';
import {ContentGenerationRejected} from '../../lib/content/neon-content-generation-contract.ts';
import {createContentWorkspaceGet} from '../../lib/content/neon-content-workspace-http.ts';
import {createContentNeonSessionVerifier} from '../../lib/content/neon-content-session-verifier.ts';
import {parseContentWorkspaceDetail} from '../../lib/content/neon-content-workspace-detail-response.ts';
import {buildContentCampaignView} from '../../lib/content/neon-content-campaign-view.ts';
import {buildContentPublishPreview} from '../../lib/content/neon-content-publish-preview.ts';

const isLocal=(url,expectedUser)=>
 typeof url==='string'&&url.startsWith('postgresql://'+expectedUser+':')&&
 url.includes('@127.0.0.1:5432/bros_intelligence_dev')&&!url.includes('?');
if(process.env.CONTENT_PG_INTEGRATION_CI!=='disposable_only'||
 !isLocal(process.env.CONTENT_ADMIN_DB_URL,'postgres')||
 !isLocal(process.env.CONTENT_TEST_DB_URL,'content_dev_generated_writer_v1')||
 !isLocal(process.env.CONTENT_READER_DB_URL,'content_dev_reader_v2'))
 throw Error('Refusing non-disposable CONTENT PostgreSQL database target');

const TENANT='33333333-3333-4333-8333-333333333333';
const OTHER_TENANT='66666666-6666-4666-8666-666666666666';
const OWNER='8ae086ff-3f10-4863-b5e7-4b67e062024d';
const OTHER='11111111-1111-4111-8111-111111111111';
const WORKSPACE='22222222-2222-4222-8222-222222222222';
const OTHER_WORKSPACE='77777777-7777-4777-8777-777777777777';
const principal={userId:OWNER,authenticated:true};
const otherPrincipal={userId:OTHER,authenticated:true};
const admin=new pg.Pool({connectionString:process.env.CONTENT_ADMIN_DB_URL,max:2});
const writerPool=new pg.Pool({connectionString:process.env.CONTENT_TEST_DB_URL,max:3});
const readerPool=new pg.Pool({connectionString:process.env.CONTENT_READER_DB_URL,max:3});
after(async()=>{await Promise.all([admin.end(),writerPool.end(),readerPool.end()]);});

const persist=createContentGeneratedOutputWriter(createContentTransaction(writerPool));
const read=createContentWorkspaceReader(createContentTransaction(readerPool));
const input={
 product_service:'BROS CONTENT',audience:'Malaysian independent sellers',
 description:'Marketing content planning operating system',
 problem:'No consistent useful content',objective:'Educate buyers',
 duration_days:7,platforms:['facebook','instagram','tiktok']
};
const sevenLayers={
 strategy:{positioning:'Practical content operations',
  core_message:'Explain one selling moment at a time',
  offer_angle:'Content planning instead of blind posting',
  platform_strategy:['Short educational clips','Owner-focused Facebook posts']},
 angles:[{title:'Real selling moment',hook:'Why did your post fail?',
  reason:'No buyer problem was addressed'}],
 scripts:[
  {title:'The stalled sale',hook:'Your audience did not ask for another ad',
   body:'Explain their actual problem before introducing a solution.',
   cta:'Save the framework'},
  {title:'The follow-up',hook:'A useful follow-up is not a reminder',
   body:'Clarify the next decision the buyer needs to make.',
   cta:'Request the guide'}
 ],
 scenes:[
  {scene_number:1,duration_seconds:5,visual_prompt:'Malay-speaking owner at a desk',
   motion_prompt:'Gentle pan',narration:'Show the buyer problem',dialogue:''},
  {scene_number:2,duration_seconds:7,visual_prompt:'Seller writing a clear content plan',
   motion_prompt:'Slow push-in',narration:'One practical next step',dialogue:''}
 ],
 visuals:[
  {title:'Selling-moment board',prompt:'Natural workdesk, cream paper, dark navy'},
  {title:'Content checklist',prompt:'Malay content planning checklist, no logo recreation'}
 ],
 captions:[
  {platform:'facebook',caption:'Bermula dengan masalah pelanggan sebenar.'},
  {platform:'instagram',caption:'Satu masalah. Satu prinsip. Satu tindakan.'},
  {platform:'tiktok',caption:'Tak semua post perlu jadi iklan.'}
 ],
 publish_plan:[
  {day:1,platform:'facebook',content_type:'educational',objective:'Teach'},
  {day:2,platform:'instagram',content_type:'carousel',objective:'Explain'},
  {day:3,platform:'tiktok',content_type:'video',objective:'Diagnose'}
 ]
};
const qc={pass:true,score:92,issues:[],fixes:[]};
const validModelCalls=[];
const model=async(prompt,schema,name)=>{
 validModelCalls.push({prompt,schema,name});
 return name==='bros_campaign'?sevenLayers:qc;
};
const planner=createContentCampaignPlanner(model);
async function tenantCounts(){
 const r=await admin.query(`SELECT
  (SELECT count(*)::int FROM content_dev.campaigns WHERE tenant_id=$1) AS campaigns,
  (SELECT count(*)::int FROM content_dev.content_items WHERE tenant_id=$1) AS items,
  (SELECT count(*)::int FROM content_dev.scenes WHERE tenant_id=$1) AS scenes,
  (SELECT count(*)::int FROM content_dev.generated_output_requests WHERE tenant_id=$1) AS requests,
  (SELECT count(*)::int FROM content_dev.credit_ledger) AS credits,
  (SELECT count(*)::int FROM content_dev.generation_jobs) AS jobs`,[TENANT]);
 return r.rows[0];
}

test('disposable real PostgreSQL: deterministic seven-layer preview → QC → writer → reader',async t=>{
 await t.test('both SQL connections have distinct least-privilege login roles',async()=>{
  const [writer,reader]=await Promise.all([
   writerPool.query('SELECT current_user AS role'),
   readerPool.query('SELECT current_user AS role')
  ]);
  assert.equal(writer.rows[0].role,'content_dev_generated_writer_v1');
  assert.equal(reader.rows[0].role,'content_dev_reader_v2');
  const r=await readerPool.query(`SELECT
    has_table_privilege(current_user,'content_dev.campaigns','INSERT') AS campaigns_write,
    has_table_privilege(current_user,'content_dev.content_items','INSERT') AS items_write,
    has_table_privilege(current_user,'content_dev.credit_ledger','SELECT') AS credits_read,
    has_schema_privilege(current_user,'content_import_dev','USAGE') AS legacy_access`);
  assert.deepEqual(r.rows[0],{
   campaigns_write:false,items_write:false,credits_read:false,legacy_access:false
  });
 });

 let generatedCampaign;
 await t.test('deterministic provider returns seven-layer plan + QC without any SQL writes',async()=>{
  const before=await tenantCounts();
  const planned=await planner(input,{brand_name:'BROS CONTENT',voice:'Malay first'});
  assert.equal(planned.operation,'preview_only');
  assert.equal(planned.readyForPersistence,false);
  assert.equal(planned.gate.accepted,true);
  assert.equal(planned.plan.scripts.length,2);
  assert.equal(planned.plan.scenes.length,2);
  assert.deepEqual(validModelCalls.map(call=>call.name),['bros_campaign','bros_qc']);
  assert.deepEqual(validModelCalls[0].schema.required,[
   'strategy','angles','scripts','scenes','visuals','captions','publish_plan'
  ]);
  assert.deepEqual(await tenantCounts(),before);
  generatedCampaign=planned;
 });
 let created;
 await t.test('explicit isolated writer persists draft with full materialization',async()=>{
  const before=await tenantCounts();
  created=await persist(principal,WORKSPACE,'ci-synthetic-plan-20261107',
   input,generatedCampaign.plan,generatedCampaign.review);
  assert.equal(created.replayed,false);
  assert.equal(created.status,'draft');
  const current=await tenantCounts();
  assert.deepEqual(current,{
   campaigns:before.campaigns+1,
   items:before.items+5, // 2 scripts + 2 visuals + one video_scenes container
   scenes:before.scenes+2,
   requests:before.requests+1,
   credits:before.credits,
   jobs:before.jobs
  });
 });
 await t.test('production-facing restricted workspace read sees generated draft and all content',async()=>{
  const result=await read(principal,WORKSPACE);
  assert.equal(result.workspace.id,WORKSPACE);
  assert.equal(result.workspace.tenant_id,TENANT);
  const campaign=result.campaigns.find(x=>x.id===created.id);
  assert.ok(campaign);
  assert.equal(campaign.status,'draft');
  assert.equal(campaign.product_service,'BROS CONTENT');
  assert.deepEqual(campaign.strategy,sevenLayers.strategy);
  assert.deepEqual(campaign.angles,sevenLayers.angles);
  assert.deepEqual(campaign.captions,{
   facebook:'Bermula dengan masalah pelanggan sebenar.',
   instagram:'Satu masalah. Satu prinsip. Satu tindakan.',
   tiktok:'Tak semua post perlu jadi iklan.'
  });
  assert.deepEqual(campaign.publish_plan,sevenLayers.publish_plan);
  const items=result.contentItems.filter(i=>i.campaign_id===created.id);
  assert.equal(items.length,5);
  assert.equal(items.filter(i=>i.type==='script').length,2);
  assert.equal(items.filter(i=>i.type==='visual_prompt').length,2);
  assert.equal(items.filter(i=>i.type==='video_scenes').length,1);
  const manifest=items.find(i=>i.type==='video_scenes');
  assert.deepEqual(manifest.body,{count:2});
  const sceneRows=result.scenes.filter(s=>s.content_item_id===manifest.id);
  assert.equal(sceneRows.length,2);
  assert.deepEqual(sceneRows.map(s=>s.scene_number),[1,2]);
  assert.equal(sceneRows[0].narration,'Show the buyer problem');
  assert.equal(Number(sceneRows[1].duration_seconds),7);
 });
 await t.test('synthetic authenticated HTTP boundary reads actual PostgreSQL rows into seven-layer UI preview',async()=>{
  // Only test-owned synthetic session values are mapped to fixture principals.
  // This verifies HTTP authorization/serialization plus real restricted PG RLS;
  // it is NOT a test of the deployed Neon Auth SDK or browser login.
  const verify=async request=>{
   const session=request.headers.get('x-ci-fixture-session');
   return session==='owner'?principal:session==='foreign'?otherPrincipal:null;
  };
  const handler=createContentWorkspaceGet(verify,read);
  const request=(workspaceId=WORKSPACE,session='owner',method='GET')=>
   new Request('https://content-ci.example.test/api/content/dev/workspaces/'+workspaceId,{
    method,headers:session?{'x-ci-fixture-session':session}:{}
   });
  const baseline=await tenantCounts();
  const response=await handler(request(),WORKSPACE);
  assert.equal(response.status,200);
  assert.equal(response.headers.get('cache-control'),'no-store');
  const workspace=parseContentWorkspaceDetail(await response.json(),WORKSPACE);
  const campaign=workspace.campaigns.find(row=>row.id===created.id);
  assert.ok(campaign,'Committed campaign must survive real SQL→HTTP→strict response validation');
  const view=buildContentCampaignView(campaign);
  assert.equal(view.hasGeneratedContent,true);
  assert.equal(view.strategy.length,3);
  assert.equal(view.angles.length,1);
  assert.equal(view.captions.length,3);
  assert.equal(view.publishPlan.length,3);
  const preview=buildContentPublishPreview(campaign);
  assert.equal(preview.length,3);
  assert.ok(preview.every(entry=>entry.captionAvailable));
  assert.deepEqual(preview.map(entry=>entry.platform),['facebook','instagram','tiktok']);
  assert.deepEqual(preview.map(entry=>entry.caption),[
   'Bermula dengan masalah pelanggan sebenar.',
   'Satu masalah. Satu prinsip. Satu tindakan.',
   'Tak semua post perlu jadi iklan.'
  ]);
  const items=workspace.contentItems.filter(row=>row.campaign_id===created.id);
  assert.equal(items.filter(row=>row.type==='script').length,2);
  assert.equal(items.filter(row=>row.type==='visual_prompt').length,2);
  const scenesItem=items.find(row=>row.type==='video_scenes');
  assert.ok(scenesItem);
  assert.equal(workspace.scenes.filter(row=>row.content_item_id===scenesItem.id).length,2);

  // A missing/foreign session is denied by the same HTTP handler, with no
  // serialized tenant data and no permission-raising adapter in the harness.
  const unauthenticated=await handler(request(WORKSPACE,''),WORKSPACE);
  assert.equal(unauthenticated.status,401);
  assert.deepEqual(await unauthenticated.json(),{error:'unauthorized'});
  const foreign=await handler(request(WORKSPACE,'foreign'),WORKSPACE);
  assert.equal(foreign.status,404);
  const foreignBody=await foreign.text();
  assert.equal(foreignBody.includes(TENANT),false);
  assert.deepEqual(JSON.parse(foreignBody),{error:'not_found'});
  const invalid=await handler(request('invalid-workspace-id'),'invalid-workspace-id');
  assert.equal(invalid.status,404);
  const writeMethod=await handler(request(WORKSPACE,'owner','POST'),WORKSPACE);
  assert.equal(writeMethod.status,405);
  assert.deepEqual(await tenantCounts(),baseline,'HTTP read and denial paths cannot mutate persisted rows');
 });
 await t.test('actual Neon Auth verifier boundary authorizes restricted PostgreSQL readback',async()=>{
  const authBase='https://ep-ci-fixture.neonauth.c-4.ap-southeast-1.aws.neon.tech/db/auth';
  const verifiedCookies=[];
  // The verifier implementation is real. Only its remote Neon Auth response
  // is replaced by deterministic fixtures; no network, live auth or secrets.
  const verify=createContentNeonSessionVerifier(authBase,async(url,init)=>{
   assert.equal(url,authBase+'/get-session');
   assert.equal(init.method,'GET');
   assert.equal(init.redirect,'error');
   assert.equal(init.cache,'no-store');
   assert.equal(init.headers.authorization,undefined);
   verifiedCookies.push(init.headers.cookie);
   const cookie=init.headers.cookie;
   if(cookie==='better-auth.session_token=fixture-owner')
    return Response.json({user:{id:OWNER},session:{userId:OWNER}});
   if(cookie==='better-auth.session_token=fixture-foreign')
    return Response.json({user:{id:OTHER},session:{userId:OTHER}});
   if(cookie==='better-auth.session_token=fixture-mismatch')
    return Response.json({user:{id:OWNER},session:{userId:OTHER}});
   return new Response(null,{status:401});
  });
  const handler=createContentWorkspaceGet(verify,read);
  const request=(cookie,extra={})=>new Request(
   'https://content-ci.example.test/api/content/dev/workspaces/'+WORKSPACE,{
    headers:{...(cookie?{cookie}:{}),...extra}
   });
  const baseline=await tenantCounts();
  const ok=await handler(request('analytics=not-forwarded; better-auth.session_token=fixture-owner'),WORKSPACE);
  assert.equal(ok.status,200);
  const detail=parseContentWorkspaceDetail(await ok.json(),WORKSPACE);
  assert.ok(detail.campaigns.some(row=>row.id===created.id));
  assert.equal(verifiedCookies[0],'better-auth.session_token=fixture-owner');
  const foreign=await handler(request('better-auth.session_token=fixture-foreign'),WORKSPACE);
  assert.equal(foreign.status,404);
  assert.deepEqual(await foreign.json(),{error:'not_found'});
  const mismatch=await handler(request('better-auth.session_token=fixture-mismatch'),WORKSPACE);
  assert.equal(mismatch.status,401);
  const missing=await handler(request(''),WORKSPACE);
  assert.equal(missing.status,401);
  const duplicate=await handler(request('better-auth.session_token=fixture-owner; better-auth.session_token=fixture-owner'),WORKSPACE);
  assert.equal(duplicate.status,401);
  const spoof=await handler(request('better-auth.session_token=fixture-foreign',{'x-user-id':OWNER}),WORKSPACE);
  assert.equal(spoof.status,404,'untrusted client identity header cannot override the verified session');
  assert.equal(verifiedCookies.length,4,'missing and duplicate session cookies must not call Auth');
  assert.deepEqual(await tenantCounts(),baseline);
 });
 await t.test('foreign tenant cannot read generated output or reuse its workspace ID',async()=>{
  await assert.rejects(read(otherPrincipal,WORKSPACE),ContentReadDenied);
  const other=await read(otherPrincipal,OTHER_WORKSPACE);
  assert.equal(other.workspace.tenant_id,OTHER_TENANT);
  assert.equal(other.campaigns.some(x=>x.id===created.id),false);
  assert.equal(other.contentItems.some(x=>x.campaign_id===created.id),false);
 });
 await t.test('one idempotent retry returns same campaign with zero extra writes',async()=>{
  const before=await tenantCounts();
  const replay=await persist(principal,WORKSPACE,'ci-synthetic-plan-20261107',
   input,generatedCampaign.plan,generatedCampaign.review);
  assert.deepEqual(replay,{id:created.id,status:'draft',replayed:true});
  assert.deepEqual(await tenantCounts(),before);
 });
 await t.test('low-scored QC never inserts or modifies credit ledger',async()=>{
  const rejectedReview={...qc,score:52};
  const rejectedPlanner=createContentCampaignPlanner(async(_prompt,_schema,name)=>
   name==='bros_campaign'?sevenLayers:rejectedReview);
  const before=await tenantCounts();
  const rejected=await rejectedPlanner(input,{brand_name:'BROS CONTENT'});
  assert.equal(rejected.gate.accepted,false);
  assert.equal(rejected.readyForPersistence,false);
  await assert.rejects(
   persist(principal,WORKSPACE,'ci-rejected-qc-20261107',
    input,rejected.plan,rejected.review),
   ContentGenerationRejected
  );
  assert.deepEqual(await tenantCounts(),before);
 });
 await t.test('revoked membership immediately revokes restricted reader access',async()=>{
  try{
   await admin.query(`UPDATE bci_dev.tenant_memberships SET active=false
    WHERE tenant_id=$1 AND principal_id=$2 AND product='content'`,[TENANT,OWNER]);
   await assert.rejects(read(principal,WORKSPACE),ContentReadDenied);
  }finally{
   await admin.query(`UPDATE bci_dev.tenant_memberships SET active=true
    WHERE tenant_id=$1 AND principal_id=$2 AND product='content'`,[TENANT,OWNER]);
  }
  const restored=await read(principal,WORKSPACE);
  assert.equal(restored.campaigns.some(x=>x.id===created.id),true);
 });
});
