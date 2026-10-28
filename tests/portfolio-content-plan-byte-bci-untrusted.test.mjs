/**
 * PORTFOLIO_CONTENT_PLAN_BYTES_TO_SHARED_BCI_UNTRUSTED_20261028_V1
 * Coordinator-only exact worker commits. Synthetic PNG bytes: no independently
 * generated production media, approval, provider SENT, durable audit or learning.
 * Tests the previously unproven CONTENT plan->decoded media->BCI candidate seam.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {deflateSync} from 'node:zlib';

const pins=Object.freeze({
  content:'f08e5f434221b6d36e1a45f198b113b1d8f5c233',
  bci:'d951579930c247e46587b44590d89534156e0e0c'
});
const files=[
  [pins.content,'lib/content/plan-source-byte-gate.mjs'],
  [pins.content,'lib/content/approval-request.mjs'],
  [pins.content,'lib/content/generation-intent.mjs'],
  [pins.content,'lib/content/instance-plan.mjs'],
  [pins.content,'lib/content/png-source-qa.mjs'],
  [pins.bci,'lib/bci/audit-append-plan.ts'],
  [pins.bci,'lib/bci/internal-lineage.ts']
];
const tenantId='33333333-3333-4333-8333-333333333333';
const config=()=>({
  schemaVersion:1,product:'content',tenantId,instanceId:'independent-florist',
  brand:{displayName:'Independent Florist',voice:'Clear and helpful',
    locale:'ms-MY',claimCandidates:['Flowers on request'],
    blockedClaims:['Guaranteed revenue']},
  audience:{segment:'Local gift buyers',needs:['Understand ordering']},
  goals:['Explain ordering'],
  channels:[{service:'instagram',channelId:'ig-florist'}],
  policy:{requiresContentApproval:true,requiresIndependentMediaQa:true,
    requiresEvidenceForClaims:true}
});
const brief=()=>({
  briefId:'flower-brief-1',revisionId:'rev-1',
  channelService:'instagram',channelId:'ig-florist',format:'carousel',
  assetCount:2,topic:'How to order flowers',
  hypothesis:'Clear steps may reduce confusion',
  hook:'How do you choose a bouquet?',
  measurementQuestion:'Are saves comparable at the same post age?'
});
const signature=Buffer.from([137,80,78,71,13,10,26,10]);
const table=Array.from({length:256},(_,n)=>{
  let c=n;for(let i=0;i<8;i++)c=c&1?0xedb88320^(c>>>1):c>>>1;
  return c>>>0;
});
function crc(bytes){
  let c=0xffffffff;
  for(const b of bytes)c=table[(c^b)&255]^(c>>>8);
  return (c^0xffffffff)>>>0;
}
function chunk(type,data){
  const len=Buffer.alloc(4),sum=Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body=Buffer.concat([Buffer.from(type),data]);
  sum.writeUInt32BE(crc(body));
  return Buffer.concat([len,body,sum]);
}
function png(pixel){
  const header=Buffer.alloc(13);header.writeUInt32BE(2,0);
  header.writeUInt32BE(2,4);header[8]=8;header[9]=2;
  const rows=Buffer.alloc(14,pixel);rows[0]=0;rows[7]=0;
  return Buffer.concat([signature,chunk('IHDR',header),
    chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}
function root(mediaSetId){
  return {id:'11111111-1111-4111-8111-111111111111',
    tenantId,product:'content',stage:'evidence',
    sourceSystem:'portfolio_synthetic_png',sourceRecordKey:mediaSetId,
    recordedAt:'2026-10-28T02:20:00Z',parentIds:[],
    verification:'unverified'};
}
if(process.env.GITHUB_ACTIONS!=='true'){
  test.skip('exact-worker-commit integration executes in GitHub Actions');
}else{
  test('independent CONTENT plan byte QA enters BCI only as scoped unverified candidate',async()=>{
    const dir=mkdtempSync(join(tmpdir(),'bros-plan-bytes-bci-'));
    try{
      execFileSync('git',['init','--quiet',dir],{timeout:15000});
      execFileSync('git',['-C',dir,'remote','add','origin',
        'https://github.com/bolehejassolutions/bros-commercial-intelligence.git'],
        {timeout:15000});
      for(const ref of new Set(Object.values(pins)))
        execFileSync('git',['-C',dir,'fetch','--no-tags','--depth=1','origin',ref],
          {timeout:60000,maxBuffer:2097152,stdio:'pipe'});
      for(const [ref,path] of files){
        const src=execFileSync('git',['-C',dir,'show',ref+':'+path],
          {encoding:'utf8',timeout:15000,maxBuffer:2097152});
        const target=join(dir,path);
        mkdirSync(dirname(target),{recursive:true});
        writeFileSync(target,src,{mode:0o600});
      }
      const load=async path=>import(pathToFileURL(join(dir,path)).href);
      const {inspectPlannedContentPngBytes}=await load('lib/content/plan-source-byte-gate.mjs');
      const {prepareContentApprovalRequest}=await load('lib/content/approval-request.mjs');
      const {prepareContentIndependentImageIntents}=await load('lib/content/generation-intent.mjs');
      const {planUntrustedBciAuditAppend}=await load('lib/bci/audit-append-plan.ts');
      // PORTFOLIO_CONTENT_GENERATION_INTENT_TO_BCI_UNTRUSTED_20261028_V1
      // Two declared independent prompts are NOT two generated media receipts.
      // The cross-product BCI boundary must not promote this planning output.
      const slots=[
        {slot:1,visualBrief:'Show a customer selecting a bouquet at the flower shop.',
          visualDistinction:'Scene one: customer choosing flowers in store.',
          avoid:'Avoid invented claims or unsupported testimonials.'},
        {slot:2,visualBrief:'Show the florist explaining the delivery options.',
          visualDistinction:'Scene two: florist explaining delivery options.',
          avoid:'Avoid invented claims or unsupported testimonials.'}
      ];
      const intents=prepareContentIndependentImageIntents(config(),brief(),slots);
      const intentReplay=prepareContentIndependentImageIntents(config(),brief(),slots);
      assert.equal(intents.status,'GENERATION_REQUEST_ONLY');
      assert.equal(intents.generationBatchId,intentReplay.generationBatchId);
      assert.equal(intents.jobs.length,2);
      assert.notEqual(intents.jobs[0].generationIntentId,intents.jobs[1].generationIntentId);
      assert.equal(intents.independentImagesVerified,false);
      assert.equal(intents.sourceBytesVerified,false);
      assert.equal(intents.approvalGranted,false);
      assert.equal(intents.providerSentVerified,false);
      assert.equal(intents.learningVerified,false);
      assert.equal(intents.sharedBciAuditVerified,false);
      assert.equal(intents.executionAllowed,false);
      assert.throws(()=>planUntrustedBciAuditAppend(
        {tenantId,product:'content'},[],[intents]),/Invalid BCI audit append/);
      const intentCandidate={...root(intents.generationBatchId),
        sourceSystem:'content_generation_intent'};
      const intentPlan=planUntrustedBciAuditAppend(
        {tenantId,product:'content'},[],[intentCandidate]);
      assert.equal(intentPlan.toInsert.length,1);
      assert.equal(intentPlan.toInsert[0].verification,'unverified');
      assert.equal(intentPlan.authenticated,false);
      assert.equal(intentPlan.providerAttested,false);
      assert.equal(intentPlan.persisted,false);
      assert.equal(intentPlan.structurallyLinkedLearnings,0);
      assert.equal(planUntrustedBciAuditAppend(
        {tenantId,product:'content'},[intentCandidate],[intentCandidate]).toInsert.length,0);
      assert.throws(()=>planUntrustedBciAuditAppend(
        {tenantId,product:'content'},[],[{...intentCandidate,verification:'verified'}]),
        /Invalid BCI audit append/);
      assert.throws(()=>planUntrustedBciAuditAppend(
        {tenantId,product:'demand'},[],[intentCandidate]),
        /Invalid BCI evidence lineage/);
      const modifiedSlots=slots.map(x=>({...x}));
      modifiedSlots[0].visualBrief='Show a customer comparing two bouquet sizes in store.';
      const changedIntents=prepareContentIndependentImageIntents(config(),brief(),modifiedSlots);
      assert.notEqual(changedIntents.generationBatchId,intents.generationBatchId);
      assert.equal(changedIntents.sourceBytesVerified,false);
      // Intent count/IDs cannot bypass duplicate actual image-byte QA.
      const source=[png(20),png(30)],options={expectedWidth:2,expectedHeight:2};
      const qa=inspectPlannedContentPngBytes(config(),brief(),source,options);
      const repeat=inspectPlannedContentPngBytes(config(),brief(),source,options);
      assert.equal(qa.status,'SOURCE_BYTE_QA_ONLY');
      assert.equal(qa.product,'content');
      assert.equal(qa.images.length,2);
      assert.equal(qa.sourceBytesStructurallyVerified,true);
      assert.equal(qa.distinctRenderedPixelsVerified,true);
      assert.equal(qa.mediaSetId,repeat.mediaSetId);
      assert.equal(qa.planId,repeat.planId);
      for(const flag of ['independentGenerationVerified','visualEditorialQaVerified',
        'claimEvidenceVerified','approvalAuthenticated','providerMediaBytesVerified',
        'providerCapabilityVerified','providerSentVerified','measurementVerified',
        'sharedBciAuditVerified','executionAllowed','customerSaasReady'])
        assert.equal(qa[flag],false,flag);

      // PORTFOLIO_CONTENT_REVIEW_TO_BCI_UNTRUSTED_20261028_V1
      // Latest CONTENT review request binds source bytes, media order, copy and
      // disclosure, but is NOT an authenticated approval or provider event.
      const copy={schemaVersion:1,caption:'Choose a bouquet in two steps.',
        altTexts:['Step one: ask about the occasion.',
          'Step two: confirm preferred colours.'],
        aiDisclosure:'DECLARED_AI',claimEvidenceRefs:[]};
      const review=prepareContentApprovalRequest(config(),brief(),source,copy,options);
      assert.equal(review.status,'REVIEW_REQUEST_ONLY');
      assert.equal(review.planId,qa.planId);
      assert.equal(review.mediaSetId,qa.mediaSetId);
      assert.equal(review.imageDigests.length,qa.images.length);
      assert.equal(review.approvalRequestId,
        prepareContentApprovalRequest(config(),brief(),source,copy,options).approvalRequestId);
      const changedCopy={...copy,caption:'Choose a bouquet in three steps.'};
      assert.notEqual(review.approvalRequestId,
        prepareContentApprovalRequest(config(),brief(),source,changedCopy,options).approvalRequestId);
      for(const flag of ['independentGenerationVerified','editorialQaVerified',
        'aiDisclosureVerified','claimEvidenceVerified','approvalAuthenticated',
        'approvalGranted','providerCapabilityVerified','providerSentVerified',
        'measurementVerified','learningVerified','sharedBciAuditVerified',
        'executionAllowed','customerSaasReady'])
        assert.equal(review[flag],false,flag);
      assert.throws(()=>planUntrustedBciAuditAppend(
        {tenantId,product:'content'},[],[review]),/Invalid BCI audit append/);
      const reviewCandidate={...root(review.approvalRequestId),
        sourceSystem:'content_review_request'};
      const reviewPlan=planUntrustedBciAuditAppend(
        {tenantId,product:'content'},[],[reviewCandidate]);
      assert.equal(reviewPlan.toInsert.length,1);
      assert.equal(reviewPlan.toInsert[0].verification,'unverified');
      assert.equal(reviewPlan.authenticated,false);
      assert.equal(reviewPlan.providerAttested,false);
      assert.equal(reviewPlan.persisted,false);
      assert.equal(reviewPlan.structurallyLinkedLearnings,0);
      assert.equal(planUntrustedBciAuditAppend(
        {tenantId,product:'content'},[reviewCandidate],[reviewCandidate]).toInsert.length,0);
      assert.throws(()=>planUntrustedBciAuditAppend(
        {tenantId,product:'content'},[],[{...reviewCandidate,verification:'verified'}]),
        /Invalid BCI audit append/);
      assert.throws(()=>planUntrustedBciAuditAppend(
        {tenantId,product:'demand'},[],[reviewCandidate]),
        /Invalid BCI evidence lineage/);

      const candidate=root(qa.mediaSetId),scope={tenantId,product:'content'};
      const append=planUntrustedBciAuditAppend(scope,[],[candidate]);
      assert.equal(append.toInsert.length,1);
      assert.equal(append.structurallyLinkedLearnings,0);
      assert.equal(append.authenticated,false);
      assert.equal(append.providerAttested,false);
      assert.equal(append.persisted,false);
      assert.equal(planUntrustedBciAuditAppend(scope,[candidate],[candidate]).toInsert.length,0);
      assert.throws(()=>planUntrustedBciAuditAppend(scope,[],[qa]),
        /Invalid BCI audit append/);
      assert.throws(()=>planUntrustedBciAuditAppend(scope,[],[
        {...candidate,verification:'verified'}]),/Invalid BCI audit append/);
      assert.throws(()=>planUntrustedBciAuditAppend(
        {tenantId,product:'demand'},[],[candidate]),/Invalid BCI evidence lineage/);
      assert.throws(()=>planUntrustedBciAuditAppend(
        {tenantId:'44444444-4444-4444-8444-444444444444',product:'content'},
        [],[candidate]),/Invalid BCI evidence lineage/);

      assert.throws(()=>inspectPlannedContentPngBytes(config(),brief(),
        [source[0],source[0]],options),/PNG_QA_DUPLICATE_BYTES/);
      const revised=brief();revised.revisionId='rev-2';
      const qaRevised=inspectPlannedContentPngBytes(config(),revised,source,options);
      assert.notEqual(qaRevised.mediaSetId,qa.mediaSetId);
      const other=config();other.tenantId='44444444-4444-4444-8444-444444444444';
      assert.notEqual(inspectPlannedContentPngBytes(other,brief(),source,options).mediaSetId,
        qa.mediaSetId);
    }finally{
      rmSync(dir,{recursive:true,force:true,maxRetries:8,retryDelay:150});
    }
  });
}
