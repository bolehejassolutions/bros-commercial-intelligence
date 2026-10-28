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
  content:'e4b9d15364132379da5adada335c39df295ffce6',
  bci:'6d870dd16023370de307eb4fe89050c38ecdf9cc'
});
const files=[
  [pins.content,'lib/content/plan-source-byte-gate.mjs'],
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
      const {inspectPlannedContentPngBytes}=await load(files[0][1]);
      const {planUntrustedBciAuditAppend}=await load(files[3][1]);
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
