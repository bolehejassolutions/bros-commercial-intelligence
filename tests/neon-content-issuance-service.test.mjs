import test from 'node:test';
import assert from 'node:assert/strict';
import {createNeonContentIssuanceService} from '../lib/bci/neon-content-issuance-service.ts';
import {createContentIssuanceHttpHandler} from '../lib/bci/neon-content-issuance-http.ts';
const user='11111111-1111-4111-8111-111111111111',tenant='22222222-2222-4222-8222-222222222222';
const proof='content-instance-script-proof-'+'a'.repeat(64);
const input=()=>({proofEnvelopeId:proof,receipt:Object.fromEntries(['editorial','script','dispatch']
  .map(k=>[k,{payload:{reviewerSubject:user,tenantId:tenant,product:'content'}}]))});
const committed={status:'BCI_CONTENT_V3_APPROVAL_COMMITTED',approvalId:'approved-source-1',
  committedReadback:true,providerSent:false,executionAllowed:false};
function setup(change={}) {
  const calls=[];
  const deps={authenticate:async token=>{calls.push('auth');assert.equal(token,'a.b.c');return {userId:user};},
    membershipsFor:async()=>[{principalId:user,tenantId:tenant,product:'content',active:true}],
    loadSource:async(scope,id)=>{calls.push('source');assert.equal(id,proof);assert.equal(scope.tenantId,tenant);
      return {envelope:{schemaVersion:3,product:'content',tenantId:tenant,proofEnvelopeId:proof},
        mediaBytes:[Buffer.alloc(64,1),Buffer.alloc(64,2)],verifyCompleteScriptSourceContext:async()=>true};},
    createIssuer:()=>({issueScript:async request=>{calls.push('issue');assert.equal(request.envelope.proofEnvelopeId,proof);return committed;}}),...change};
  return {run:createNeonContentIssuanceService(deps),calls};
}
test('request-local service loads server-owned originals after auth and normalizes committed V3 receipt (mock storage)',async()=>{
  const x=setup();assert.deepEqual(await x.run('a.b.c',input()),committed);
  assert.deepEqual(x.calls,['auth','source','issue','auth']);
});
test('missing session or foreign product cannot load a protected source',async()=>{
  for(const change of [{authenticate:async()=>{throw Error('secret driver detail');}},
    {membershipsFor:async()=>[{principalId:user,tenantId:tenant,product:'demand',active:true}]}]){
    const x=setup(change);await assert.rejects(x.run('a.b.c',input()),/BCI_CONTENT_ISSUANCE_DENIED/);
    assert.ok(!x.calls.includes('source'));assert.ok(!x.calls.includes('issue'));
  }
});
test('caller source/tenant injection and receipts from a foreign reviewer never reach issuer',async()=>{
  for(const mutate of [p=>{p.envelope={};},p=>{p.tenantId=tenant;},
    p=>{p.receipt.script.payload.reviewerSubject=tenant;}]){
    const x=setup(),p=input();mutate(p);await assert.rejects(x.run('a.b.c',p));assert.ok(!x.calls.includes('issue'));
  }
});
test('membership revoked after commit cannot be presented as current approval acceptance',async()=>{
  let n=0;const x=setup({membershipsFor:async()=>++n===1?
    [{principalId:user,tenantId:tenant,product:'content',active:true}]:[]});
  await assert.rejects(x.run('a.b.c',input()));assert.ok(x.calls.includes('issue'));
});
const env={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'feat/neon-bci-dev-ledger-20261025',
  BCI_NEON_DEV_PRIVATE_READS:'enabled',BCI_NEON_DEV_CONTENT_APPROVALS:'enabled'};
const origin='https://bci.test';
function request(body=input(),extra={}){return new Request(origin+'/api/internal/neon-content-approval',{
  method:'POST',headers:{origin,'content-type':'application/json',authorization:'Bearer a.b.c',...extra},body:JSON.stringify(body)});}
test('same-origin POST transports the normalized receipt with no-store; CSRF, scope injection and oversized input deny',async()=>{
  let writes=0;const handle=createContentIssuanceHttpHandler({env:()=>env,execute:async()=>{writes++;return committed;}});
  const ok=await handle(request());assert.equal(ok.status,200);assert.match(ok.headers.get('cache-control'),/no-store/);
  assert.deepEqual(await ok.json(),committed);
  for(const [req,status] of [[request(input(),{origin:'https://foreign.test'}),403],
    [request({...input(),tenantId:tenant}),400],[request({proofEnvelopeId:proof,receipt:'x'.repeat(131072)}),400],
    [request(input(),{'x-admin':'true'}),400]])assert.equal((await handle(req)).status,status);
  assert.equal(writes,1);
});
test('approval transport remains unavailable in production and while the exact feature is disabled',async()=>{
  for(const delta of [{VERCEL_ENV:'production'},{BCI_NEON_DEV_CONTENT_APPROVALS:undefined}]){
    const handle=createContentIssuanceHttpHandler({env:()=>({...env,...delta}),execute:async()=>assert.fail('must not write')});
    assert.equal((await handle(request())).status,404);
  }
});
