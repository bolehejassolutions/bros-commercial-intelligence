import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {verifyPngSourceBytes} from '../lib/content/png-source-qa.mjs';
import {inspectUnboundContentReviewPackSource as inspect, inspectUnboundContentReviewPackAllSources as inspectAll} from '../lib/content/review-pack-source-intake.mjs';
const table=Array.from({length:256},(_,n)=>{let c=n;for(let i=0;i<8;i++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function chunk(name,data){
 const body=Buffer.concat([Buffer.from(name),data]),h=Buffer.alloc(4),t=Buffer.alloc(4);
 h.writeUInt32BE(data.length);let c=0xffffffff;
 for(const b of body)c=table[(c^b)&255]^(c>>>8);
 t.writeUInt32BE((c^0xffffffff)>>>0);return Buffer.concat([h,body,t]);
}
function png(pixel){
 const h=Buffer.alloc(13);h.writeUInt32BE(2,0);h.writeUInt32BE(2,4);h[8]=8;h[9]=2;
 const rows=Buffer.alloc(14,pixel);rows[0]=0;rows[7]=0;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),
 chunk('IHDR',h),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}
const sources=[png(20),png(30),png(40)],dims={expectedWidth:2,expectedHeight:2};
const config=()=>({schemaVersion:1,product:'content',tenantId:'tenant-florist',
 instanceId:'florist-internal',brand:{displayName:'Local Florist',
 voice:'Clear and helpful',locale:'en-MY',claimCandidates:[],blockedClaims:['Guaranteed income']},
 audience:{segment:'Local gift buyers',needs:['Understand ordering']},
 goals:['Explain ordering'],channels:[{service:'facebook',channelId:'fb-florist'},
 {service:'instagram',channelId:'ig-florist'}],
 policy:{requiresContentApproval:true,requiresIndependentMediaQa:true,requiresEvidenceForClaims:true}});
const brief=(service='facebook')=>({briefId:'brief-001',revisionId:'rev-1',
 channelService:service,channelId:service==='facebook'?'fb-florist':'ig-florist',
 format:service==='facebook'?'single_image':'carousel',
 assetCount:service==='facebook'?1:2,topic:'Ordering flowers',
 hypothesis:'Clear steps may reduce confusion',hook:'What should I check first?',
 measurementQuestion:'Are saves recorded?'});
function media(source,slot,fileId){
 const qa=verifyPngSourceBytes(source,dims);
 return {slot,driveFileId:fileId,sourceSha256:qa.sha256,
 decodedRgbaSha256:qa.decodedRgbaSha256,byteLength:source.length,
 altText:'Slide '+slot+' shows a clear step.'};
}
function review(service,items){
 return {service,format:service==='facebook'?'single_image':'carousel',
 assetCount:items.length,hook:'What should I check first?',
 caption:'A useful fictional example. AI-generated illustration.',
 altTexts:items.map(x=>x.altText),aiDisclosure:'DECLARED_AI',claimEvidenceRefs:[],
 media:items,reviewStatus:'REVIEW_REQUIRED',reviewCandidateId:'review-'+service,
 channelId:null,planId:null,mediaSetId:null,approvalRequestId:null,
 signedApprovalId:null,providerSentId:null,metrics:null,learning:null,executionAllowed:false};
}
const pack=()=>({schemaVersion:1,product:'content',
 scope:'UNBOUND_EDITORIAL_REVIEW_CANDIDATE_ONLY',tenantId:null,instanceId:null,
 providerOrganizationId:null,semanticReviewSigned:false,allAcceptanceGatesOpen:true,
 executionAllowed:false,channelReviews:[
 review('facebook',[media(sources[0],1,'drive-file-001')]),
 review('instagram',[media(sources[1],1,'drive-file-002'),
 media(sources[2],2,'drive-file-003')])]});
const run=(p=pack(),id='review-facebook',cfg=config(),b=brief(),bytes=[sources[0]])=>
 inspect(p,id,cfg,b,bytes,dims);
test('real PNG bytes produce deterministic nonauthorizing source-bound review',()=>{
 const a=run();assert.deepEqual(a,run());
 assert.equal(a.status,'SOURCE_BYTES_MATCHED_REVIEW_REQUIRED');
 assert.match(a.approvalRequestId,/^content-review-[a-f0-9]{64}$/);
 for(const key of ['sourceReferencesAuthenticated','instanceBindingAuthenticated',
 'signedHumanReviewVerified','durableApprovalRecorded','atomicReservationVerified',
 'providerSentVerified','measurementVerified','learningVerified',
 'executionAllowed','customerSaasReady'])assert.equal(a[key],false,key);
});
test('carousel source order and configured channel cannot be silently substituted',()=>{
 const a=run(pack(),'review-instagram',config(),brief('instagram'),sources.slice(1));
 assert.equal(a.sourceDriveFileIds.length,2);
 assert.throws(()=>run(pack(),'review-instagram',config(),brief('instagram'),
 sources.slice(1).reverse()),/CONTENT_UNBOUND_REVIEW_PACK_INTAKE_DENIED/);
 const c=config();c.channels[1].channelId='other-channel';
 assert.throws(()=>run(pack(),'review-instagram',c,brief('instagram'),
 sources.slice(1)),/CONTENT_UNBOUND_REVIEW_PACK_INTAKE_DENIED/);
});
test('source SHA, pixel hash, bytes, alt text and cross-channel duplicates fail closed',()=>{
 for(const mutate of [
 p=>{p.channelReviews[0].media[0].sourceSha256='a'.repeat(64);},
 p=>{p.channelReviews[0].media[0].decodedRgbaSha256='a'.repeat(64);},
 p=>{p.channelReviews[0].media[0].byteLength++;},
 p=>{p.channelReviews[0].media[0].altText='Different alt';},
 p=>{p.channelReviews[1].media[1].sourceSha256=p.channelReviews[0].media[0].sourceSha256;},
 p=>{p.channelReviews[1].media[1].driveFileId=p.channelReviews[0].media[0].driveFileId;}
 ]){const p=pack();mutate(p);
 assert.throws(()=>run(p),/CONTENT_UNBOUND_REVIEW_PACK_INTAKE_DENIED/);}
});
test('unbound pack cannot assert tenant binding, approval, SENT or execution',()=>{
 for(const mutate of [
 p=>{p.tenantId='tenant-florist';},p=>{p.semanticReviewSigned=true;},
 p=>{p.executionAllowed=true;},p=>{p.channelReviews[0].reviewStatus='APPROVED';},
 p=>{p.channelReviews[0].signedApprovalId='fake';},
 p=>{p.channelReviews[0].providerSentId='fake';},
 p=>{p.channelReviews[0].channelId='fb-florist';},
 p=>{p.channelReviews[0].executionAllowed=true;}
 ]){const p=pack();mutate(p);
 assert.throws(()=>run(p),/CONTENT_UNBOUND_REVIEW_PACK_INTAKE_DENIED/);}
});
test('getter, sparse array, changed hook and unknown candidate fail closed',()=>{
 const p=pack();Object.defineProperty(p.channelReviews[0],'caption',{
 enumerable:true,get(){throw Error('GETTER_EXECUTED');}});
 assert.throws(()=>run(p),/CONTENT_UNBOUND_REVIEW_PACK_INTAKE_DENIED/);
 const sparse=pack();sparse.channelReviews=new Array(2);
 assert.throws(()=>run(sparse),/CONTENT_UNBOUND_REVIEW_PACK_INTAKE_DENIED/);
 const b=brief();b.hook='Another promise';
 assert.throws(()=>run(pack(),'review-facebook',config(),b),/CONTENT_UNBOUND_REVIEW_PACK_INTAKE_DENIED/);
 assert.throws(()=>run(pack(),'unknown-candidate'),/CONTENT_UNBOUND_REVIEW_PACK_INTAKE_DENIED/);
});

test('different PNG source bytes with identical rendered pixels across channels fail closed',()=>{
 const original=sources[0];
 // CRC-valid, display-neutral PNG text metadata changes bytes but not pixels.
 const variant=Buffer.concat([original.subarray(0,original.length-12),
   chunk('tEXt',Buffer.from('Note\\0alternate encoding')),
   original.subarray(original.length-12)]);
 const a=verifyPngSourceBytes(original,dims);
 const b=verifyPngSourceBytes(variant,dims);
 assert.notEqual(a.sha256,b.sha256);
 assert.equal(a.decodedRgbaSha256,b.decodedRgbaSha256);
 const p=pack();
 p.channelReviews[1].media[1]=media(variant,2,'drive-file-003');
 assert.throws(()=>run(p),/CONTENT_UNBOUND_REVIEW_PACK_INTAKE_DENIED/);
});


test('whole-pack original bytes are verified for every channel, not metadata only',()=>{
 const inputs=[
  {candidateId:'review-facebook',instanceConfig:config(),brief:brief('facebook'),
   sourceBuffers:[sources[0]],options:dims},
  {candidateId:'review-instagram',instanceConfig:config(),brief:brief('instagram'),
   sourceBuffers:sources.slice(1),options:dims}
 ];
 const all=inspectAll(pack(),inputs);
 assert.deepEqual(all,inspectAll(pack(),inputs));
 assert.equal(all.status,'ALL_ORIGINAL_BYTES_MATCHED_REVIEW_REQUIRED');
 assert.equal(all.channelCount,2);
 assert.equal(all.imageCount,3);
 assert.equal(all.allChannelOriginalBytesVerified,true);
 assert.equal(all.allRenderedPixelsDistinct,true);
 for(const key of ['sourceReferencesAuthenticated','instanceBindingAuthenticated',
  'signedHumanReviewVerified','durableApprovalRecorded','atomicReservationVerified',
  'providerSentVerified','measurementVerified','learningVerified',
  'executionAllowed','customerSaasReady'])assert.equal(all[key],false,key);
 assert.equal(all.channels[0].sourceDriveFileIds[0],'drive-file-001');
 assert.throws(()=>inspectAll(pack(),inputs.slice(0,1)),
   /CONTENT_UNBOUND_REVIEW_PACK_INTAKE_DENIED/);
 const swapped=[inputs[0],{...inputs[1],sourceBuffers:[sources[2],sources[1]]}];
 assert.throws(()=>inspectAll(pack(),swapped),
   /CONTENT_UNBOUND_REVIEW_PACK_INTAKE_DENIED/);
 const different=config();different.tenantId='tenant-another';
 assert.throws(()=>inspectAll(pack(),[inputs[0],{...inputs[1],instanceConfig:different}]),
   /CONTENT_UNBOUND_REVIEW_PACK_INTAKE_DENIED/);
 const duplicates=[inputs[0],{...inputs[0]}];
 assert.throws(()=>inspectAll(pack(),duplicates),
   /CONTENT_UNBOUND_REVIEW_PACK_INTAKE_DENIED/);
});
