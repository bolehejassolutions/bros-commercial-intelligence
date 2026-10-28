import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareContentIndependentImageIntents as prepare} from '../lib/content/generation-intent.mjs';

const config = () => ({
  schemaVersion:1,product:'content',tenantId:'tenant-A',instanceId:'pilot-A',
  brand:{displayName:'Independent Florist',voice:'Helpful and precise',locale:'ms-MY',
    claimCandidates:[],blockedClaims:['Guaranteed revenue']},
  audience:{segment:'Local gift buyers',needs:['Clear delivery options']},
  goals:['Explain ordering steps'],channels:[{service:'instagram',channelId:'ig-A'}],
  policy:{requiresContentApproval:true,requiresIndependentMediaQa:true,requiresEvidenceForClaims:true}
});
const brief = () => ({briefId:'brief-1',revisionId:'rev-1',channelService:'instagram',
  channelId:'ig-A',format:'carousel',assetCount:2,topic:'Flower ordering steps',
  hypothesis:'Clear steps could reduce confusion',hook:'How to order flowers?',
  measurementQuestion:'Do saves increase at comparable post age?'});
const slots = () => ([
  {slot:1,visualBrief:'Show a customer choosing flowers in a shop.',
    visualDistinction:'Opening scene: choosing the bouquet.',avoid:'Avoid unsupported claims.'},
  {slot:2,visualBrief:'Show the florist explaining delivery options.',
    visualDistinction:'Second scene: explaining delivery options.',avoid:'Avoid unsupported claims.'},
]);
test('creates deterministic nonexecuting independent-slot generation requests',()=>{
  const a=prepare(config(),brief(),slots()),b=prepare(config(),brief(),slots());
  assert.equal(a.generationBatchId,b.generationBatchId);
  assert.equal(a.jobs.length,2);
  assert.notEqual(a.jobs[0].generationIntentId,a.jobs[1].generationIntentId);
  assert.equal(a.status,'GENERATION_REQUEST_ONLY');
  assert.equal(a.executionAllowed,false);
  assert.equal(a.independentImagesVerified,false);
  assert.equal(a.jobs[0].requiredEvidence.length,4);
});
test('tenant, plan revision and visual instruction changes change identity',()=>{
  const base=prepare(config(),brief(),slots());
  const c=config();c.tenantId='tenant-B';
  assert.notEqual(base.generationBatchId,prepare(c,brief(),slots()).generationBatchId);
  const b=brief();b.revisionId='rev-2';
  assert.notEqual(base.generationBatchId,prepare(config(),b,slots()).generationBatchId);
  const s=slots();s[0].visualBrief='Show a different customer choosing flowers.';
  assert.notEqual(base.jobs[0].generationIntentId,prepare(config(),brief(),s).jobs[0].generationIntentId);
});
test('duplicate visual objectives are rejected, not called independent',()=>{
  const s=slots();s[1].visualDistinction='OPENING   SCENE: CHOOSING THE BOUQUET.';
  assert.throws(()=>prepare(config(),brief(),s),/CONTENT_DUPLICATE_VISUAL_OBJECTIVES/);
});
test('distinct objective labels cannot mask duplicated visual generation briefs',()=>{
  const a=slots();
  a[1].visualBrief='SHOW  A CUSTOMER CHOOSING FLOWERS IN A SHOP.';
  assert.throws(()=>prepare(config(),brief(),a),/CONTENT_DUPLICATE_VISUAL_BRIEFS/);
  const b=slots();
  b[1].visualBrief='Show a customer choosing flowers in a shop.';
  assert.throws(()=>prepare(config(),brief(),b),/CONTENT_DUPLICATE_VISUAL_BRIEFS/);
  const valid=prepare(config(),brief(),slots());
  assert.equal(valid.status,'GENERATION_REQUEST_ONLY');
  assert.equal(valid.independentImagesVerified,false);
  assert.equal(valid.executionAllowed,false);
});
test('rejects wrong slot order, missing slots and sparse arrays',()=>{
  const s=slots();s[0].slot=2;
  assert.throws(()=>prepare(config(),brief(),s),/CONTENT_GENERATION_SLOT_ORDER_MISMATCH/);
  assert.throws(()=>prepare(config(),brief(),slots().slice(0,1)),/INVALID_CONTENT_GENERATION_SLOTS/);
  assert.throws(()=>prepare(config(),brief(),new Array(2)),/INVALID_CONTENT_GENERATION_SLOTS/);
});
test('rejects forged provider success, hidden fields and getter side effects',()=>{
  const s=slots();s[0].providerGenerationVerified=true;
  assert.throws(()=>prepare(config(),brief(),s),/INVALID_CONTENT_GENERATION_SLOT/);
  const t=slots();Object.defineProperty(t[0],'visualBrief',{enumerable:true,get(){throw Error('GETTER_EXECUTED');}});
  assert.throws(()=>prepare(config(),brief(),t),/INVALID_CONTENT_GENERATION_SLOT/);
  const u=slots();Object.defineProperty(u[0],'secret',{value:true});
  assert.throws(()=>prepare(config(),brief(),u),/INVALID_CONTENT_GENERATION_SLOT/);
});
test('single-image planning produces one nonexecuting request',()=>{
  const b=brief();b.format='single_image';b.assetCount=1;
  const a=prepare(config(),b,slots().slice(0,1));
  assert.equal(a.jobs.length,1);
  assert.equal(a.jobs[0].status,'GENERATION_REQUEST_ONLY');
  assert.equal(a.jobs[0].providerGenerationVerified,false);
});
