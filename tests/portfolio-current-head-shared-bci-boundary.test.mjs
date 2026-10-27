/**
 * PORTFOLIO_CURRENT_HEAD_BCI_BOUNDARY_20261027_LATEST
 * Coordinator-only, exact-commit integration. Synthetic JPEG and visitor events.
 * No provider attestation, approval, publication, database write or verified learning.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {deflateSync} from 'node:zlib';
import {pathToFileURL} from 'node:url';

const pins={
  content:'3bfa118349dffddb25c18c18f1d03664ccb68c75',
  demand:'6a9bced47b22b35dda3cb8e222e3afd0a9a7d8c7',
  bci:'cee811f816c5a0d16a51a4d738034f5b2dc98f35',
};
const files=[
  [pins.content,'lib/content/jpeg-source-qa.mjs'],
  [pins.demand,'lib/demand/concurrent-control-protocol.ts'],
  [pins.demand,'lib/demand/concurrent-exposure-audit.ts'],
  [pins.bci,'lib/bci/internal-lineage.ts'],
  [pins.bci,'lib/bci/audit-append-plan.ts'],
  [pins.content,'lib/content/png-source-qa.mjs'],
  [pins.content,'lib/content/buffer-observation.mjs'],
  [pins.content,'lib/content/source-byte-provider-bridge.mjs'],
  [pins.content,'lib/content/measurement-revision.mjs'],
  [pins.demand,'lib/demand/concurrent-order-candidate-audit.ts'],
];
const tenantId='33333333-3333-4333-8333-333333333333';
const stages=['evidence','signal','case','diagnosis','decision','action','outcome','learning'];
function segment(marker,payload){
  const b=Buffer.alloc(payload.length+4);b[0]=255;b[1]=marker;
  b.writeUInt16BE(payload.length+2,2);payload.copy(b,4);return b;
}
function jpeg(){
  const frame=Buffer.alloc(15);frame[0]=8;frame.writeUInt16BE(2,1);
  frame.writeUInt16BE(2,3);frame[5]=3;
  return Buffer.concat([Buffer.from([255,216]),
    segment(0xdb,Buffer.from([0,1])),segment(0xc0,frame),
    segment(0xc4,Buffer.from([0,1])),
    segment(0xda,Buffer.from([3,1,0,2,0,3,0,0,63,0])),
    Buffer.alloc(80,3),Buffer.from([255,217])]);
}
function chain(product,key){
  const ids=stages.map((_,i)=>String(i+1).padStart(8,'0')+'-'+
    (product==='content'?'1111':'2222')+'-4111-8111-111111111111');
  return stages.map((stage,i)=>({id:ids[i],tenantId,product,stage,
    sourceSystem:'portfolio_synthetic',
    sourceRecordKey:i===0?key:'synthetic:'+product+':'+stage,
    recordedAt:'2026-10-27T10:'+String(i).padStart(2,'0')+':00Z',
    parentIds:i?[ids[i-1]]:[],verification:'unverified'}));
}

// PORTFOLIO_CONTENT_PNG_TO_BCI_UNTRUSTED_BRIDGE_20261027_2124
// Independent decoded PNG pixels -> CONTENT source/reference -> Buffer-shaped
// observation -> CONTENT private handoff -> BCI append planner. No provider auth.
const pngSig=Buffer.from([137,80,78,71,13,10,26,10]);
const crcTable=Array.from({length:256},(_,n)=>{let c=n;for(let i=0;i<8;i++)
  c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function pngCrc(buf){let c=0xffffffff;for(const v of buf)
  c=crcTable[(c^v)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
function pngChunk(type,data){
  const body=Buffer.concat([Buffer.from(type),data]),size=Buffer.alloc(4),sum=Buffer.alloc(4);
  size.writeUInt32BE(data.length);sum.writeUInt32BE(pngCrc(body));
  return Buffer.concat([size,body,sum]);
}
function distinctPng(pixel){
  const head=Buffer.alloc(13);head.writeUInt32BE(2,0);head.writeUInt32BE(2,4);
  head[8]=8;head[9]=2;
  const rows=Buffer.alloc(14,pixel);rows[0]=0;rows[7]=0;
  return Buffer.concat([pngSig,pngChunk('IHDR',head),
    pngChunk('IDAT',deflateSync(rows)),pngChunk('IEND',Buffer.alloc(0))]);
}

// PORTFOLIO_RGBA_RENDERED_DUPLICATE_TO_BCI_HOLD_20261028_V1
// Same rendered pixels with different PNG channel encodings must be rejected
// before a provider-shaped SENT observation can reach shared BCI.
function opaqueRgbaPng(pixel){
  const head=Buffer.alloc(13);head.writeUInt32BE(2,0);head.writeUInt32BE(2,4);
  head[8]=8;head[9]=6;
  const rows=Buffer.alloc(18,pixel);rows[0]=0;rows[9]=0;
  for(const i of [4,8,13,17])rows[i]=255;
  return Buffer.concat([pngSig,pngChunk('IHDR',head),
    pngChunk('IDAT',deflateSync(rows)),pngChunk('IEND',Buffer.alloc(0))]);
}

if(process.env.GITHUB_ACTIONS!=='true'){
  test.skip('exact-head integration runs only in GitHub Actions');
}else{

  test('actual distinct PNG bytes to CONTENT handoff and BCI append remain untrusted',async()=>{
    const dir=mkdtempSync(join(tmpdir(),'bros-portfolio-png-'));
    try{
      execFileSync('git',['init','--quiet',dir],{stdio:'pipe',timeout:15000});
      execFileSync('git',['-C',dir,'remote','add','origin',
        'https://github.com/bolehejassolutions/bros-commercial-intelligence.git'],
        {stdio:'pipe',timeout:15000});
      for(const ref of [pins.content,pins.bci])
        execFileSync('git',['-C',dir,'fetch','--no-tags','--depth=1','origin',ref],
          {stdio:'pipe',timeout:60000,maxBuffer:2097152});
      for(const [ref,path] of files.filter(([ref,path])=>
        ref===pins.content&&path.startsWith('lib/content/')||
        ref===pins.bci&&path.startsWith('lib/bci/'))){
        const src=execFileSync('git',['-C',dir,'show',ref+':'+path],
          {encoding:'utf8',timeout:15000,maxBuffer:2097152});
        const target=join(dir,path);mkdirSync(dirname(target),{recursive:true});
        writeFileSync(target,src,{mode:0o600});
      }
      const load=async p=>import(pathToFileURL(join(dir,p)).href);
      const {inspectContentFetchedSourceBytes}=await load('lib/content/source-byte-provider-bridge.mjs');
      const {projectBufferContentObservation,reconcileBufferListAndDetail,buildContentBciEvidenceHandoff}=
        await load('lib/content/buffer-observation.mjs');
      const {planUntrustedBciAuditAppend}=await load('lib/bci/audit-append-plan.ts');
      const scope={tenantId,product:'content',instanceId:'sell-internal',
        contentId:'seller-lesson-001',channelService:'instagram',channelId:'ig123',
        expectedAssetCount:2,asOf:'2026-10-27T12:00:00Z'};
      const urls=['https://drive.google.com/uc?id=source-a',
        'https://drive.google.com/uc?id=source-b'];
      const sources=[{bytes:distinctPng(10),url:urls[0],mimeType:'image/png'},
        {bytes:distinctPng(20),url:urls[1],mimeType:'image/png'}];
      const post={id:'buffer-post-123',status:'sent',channelService:'instagram',
        channelId:'ig123',sentAt:'2026-10-27T10:00:00Z',
        externalLink:'https://www.instagram.com/p/ABC123/',
        assets:urls.map(source=>({type:'image',source,mimeType:'image/png'})),
        text:'Seller education example',metadata:{isAiGenerated:false},
        metricsUpdatedAt:'2026-10-27T11:00:00Z',
        metrics:[{type:'views',unit:'count',value:6},
          {type:'reach',unit:'count',value:4}]};
      // Byte SHA and channel-specific pixel SHA differ for RGB/RGBA copies,
      // but the rendered RGBA pixels are identical. No BCI evidence is built.
      const sameRendered=[sources[0],
        {...sources[1],bytes:opaqueRgbaPng(10)}];
      assert.throws(()=>inspectContentFetchedSourceBytes(post,scope,sameRendered,
        {expectedWidth:2,expectedHeight:2}),/PNG_QA_DUPLICATE_RENDERED_PIXELS/);
      const differentRendered=[sources[0],
        {...sources[1],bytes:opaqueRgbaPng(20)}];
      const rgbaQa=inspectContentFetchedSourceBytes(post,scope,differentRendered,
        {expectedWidth:2,expectedHeight:2});
      assert.equal(rgbaQa.status,'SOURCE_REFERENCES_MATCHED_UNATTESTED');
      assert.equal(rgbaQa.sourcePixelIntegrityVerified,true);
      assert.equal(rgbaQa.providerByteIdentityVerified,false);
      assert.equal(rgbaQa.approvalVerified,false);
      assert.equal(rgbaQa.executionAllowed,false);
      const byteQa=inspectContentFetchedSourceBytes(post,scope,sources,
        {expectedWidth:2,expectedHeight:2});
      assert.equal(byteQa.status,'SOURCE_REFERENCES_MATCHED_UNATTESTED');
      assert.equal(byteQa.sourcePixelIntegrityVerified,true);
      assert.notEqual(byteQa.sourcePixelSha256[0],byteQa.sourcePixelSha256[1]);
      for(const k of ['providerByteIdentityVerified','approvalVerified',
        'providerAttestedByModule','executionAllowed'])assert.equal(byteQa[k],false,k);
      // PORTFOLIO_CURRENT_WORKER_NEGATIVE_RECONCILIATION_20261027_V1
      // Same provider revision but conflicting list/detail counts cannot
      // become a CONTENT BCI observation, even with genuine PNG source QA.
      assert.throws(()=>reconcileBufferListAndDetail({...post,
        metrics:[{type:'views',unit:'count',value:0}]},post,scope),
        /BUFFER_LIST_DETAIL_METRIC_CONFLICT/);
      const reconciled=reconcileBufferListAndDetail({...post,
        metrics:[{type:'views',unit:'count',value:6}]},post,scope);
      assert.equal(reconciled.status,'MEASURED');
      assert.equal(reconciled.providerAttestedByModule,false);
      assert.equal(reconciled.approvalVerified,false);
      // PORTFOLIO_CONTENT_DUPLICATE_PROVIDER_MEDIA_TO_BCI_HOLD_20261028_V1
      // Provider-shaped SENT with duplicate asset identity must never become
      // an eligible CONTENT evidence handoff or a shared BCI append input.
      const duplicateAssetId=projectBufferContentObservation({...post,
        assets:[{...post.assets[0],id:'same-provider-asset'},
          {...post.assets[1],id:'same-provider-asset'}]},scope);
      assert.equal(duplicateAssetId.status,'REVIEW_REQUIRED');
      assert.ok(duplicateAssetId.flags.includes('DUPLICATE_PROVIDER_ASSET_ID'));
      assert.throws(()=>buildContentBciEvidenceHandoff(duplicateAssetId,scope,
        '2026-10-27T11:30:00Z'),/INVALID_CONTENT_EVIDENCE_SCOPE/);
      const duplicateSource=projectBufferContentObservation({...post,
        assets:[post.assets[0],{...post.assets[1],source:post.assets[0].source}]},scope);
      assert.equal(duplicateSource.status,'REVIEW_REQUIRED');
      assert.ok(duplicateSource.flags.includes('DUPLICATE_ASSET_SOURCE'));
      assert.throws(()=>buildContentBciEvidenceHandoff(duplicateSource,scope,
        '2026-10-27T11:30:00Z'),/INVALID_CONTENT_EVIDENCE_SCOPE/);
      const observation=reconciled.observation;
      assert.equal(observation.status,'MEASURED');
      assert.equal(observation.providerAttestedByModule,false);
      const h1=buildContentBciEvidenceHandoff(observation,scope,'2026-10-27T11:30:00Z');
      const h2=buildContentBciEvidenceHandoff(observation,scope,'2026-10-27T11:45:00Z');
      assert.equal(h1.evidenceId,h2.evidenceId);
      // PORTFOLIO_CONTENT_BCI_EQUIVALENT_UTC_CROSS_HEAD_20261028_V1
      // Latest CONTENT code must dedupe equivalent provider UTC instants across
      // the private BCI boundary; do not promote provider-shaped input to proof.
      const equivalentUtc=projectBufferContentObservation({...post,
        sentAt:'2026-10-27T10:00:00.000Z',
        metricsUpdatedAt:'2026-10-27T11:00:00.000Z'},scope);
      assert.equal(equivalentUtc.status,'MEASURED');
      const equivalentHandoff=buildContentBciEvidenceHandoff(equivalentUtc,scope,
        '2026-10-27T11:45:00Z');
      assert.equal(equivalentHandoff.evidenceId,h1.evidenceId,
        'same provider UTC instant and values must reuse BCI evidence ID');
      assert.notEqual(equivalentHandoff.provenance.observedAt,h1.provenance.observedAt,
        'preserve provider raw timestamp serialization for audit');
      assert.ok(equivalentHandoff.unknowns.includes('PROVIDER_AUTHENTICATION_UNVERIFIED'));
      assert.ok(equivalentHandoff.unknowns.includes('SHARED_BCI_AUDIT_NOT_WRITTEN'));
      assert.equal(h1.provenance.completeness,'unverified');
      assert.ok(h1.unknowns.includes('PUBLICATION_APPROVAL_UNVERIFIED'));
      assert.ok(h1.unknowns.includes('NATIVE_MEDIA_BYTES_UNVERIFIED'));
      assert.ok(h1.unknowns.includes('SHARED_BCI_AUDIT_NOT_WRITTEN'));
      assert.equal(h1.metrics.views,6);
      const rootKey='content:buffer:'+h1.evidenceId;
      const records=chain('content',rootKey);
      const plan=planUntrustedBciAuditAppend({tenantId,product:'content'},[],records);
      assert.equal(plan.toInsert.length,8);
      assert.equal(plan.structurallyLinkedLearnings,1);
      for(const k of ['authenticated','providerAttested','persisted'])
        assert.equal(plan[k],false,k);
      const replay=planUntrustedBciAuditAppend({tenantId,product:'content'},records,records);
      assert.equal(replay.toInsert.length,0);
      assert.equal(replay.replayedIds.length,8);
      const changed=projectBufferContentObservation({...post,
        metrics:[{type:'views',unit:'count',value:7},{type:'reach',unit:'count',value:4}]},scope);
      const h3=buildContentBciEvidenceHandoff(changed,scope,'2026-10-27T11:45:00Z');
      assert.notEqual(h3.evidenceId,h1.evidenceId);
      const reordered=inspectContentFetchedSourceBytes(
        {...post,assets:[...post.assets].reverse()},scope,sources,
        {expectedWidth:2,expectedHeight:2});
      assert.equal(reordered.status,'REVIEW_REQUIRED');
      assert.ok(reordered.flags.includes('SOURCE_PROVIDER_REFERENCE_MISMATCH'));
      assert.throws(()=>buildContentBciEvidenceHandoff(observation,
        {...scope,tenantId:'44444444-4444-4444-8444-444444444444'},
        '2026-10-27T11:30:00Z'),/INVALID_CONTENT_EVIDENCE_SCOPE/);
      assert.throws(()=>planUntrustedBciAuditAppend(
        {tenantId,product:'demand'},[],records),/Invalid BCI evidence lineage/);
    }finally{rmSync(dir,{recursive:true,force:true,maxRetries:8,retryDelay:150});}
  });

  test('latest CONTENT JPEG and DEMAND exposure reuse BCI without trust promotion',async()=>{
    const dir=mkdtempSync(join(tmpdir(),'bros-portfolio-current-'));
    try{
      execFileSync('git',['init','--quiet',dir],{stdio:'pipe',timeout:15000});
      execFileSync('git',['-C',dir,'remote','add','origin',
        'https://github.com/bolehejassolutions/bros-commercial-intelligence.git'],
        {stdio:'pipe',timeout:15000});
      for(const ref of new Set(Object.values(pins)))
        execFileSync('git',['-C',dir,'fetch','--no-tags','--depth=1','origin',ref],
          {stdio:'pipe',timeout:60000,maxBuffer:2097152});
      for(const [ref,path] of files){
        const src=execFileSync('git',['-C',dir,'show',ref+':'+path],
          {encoding:'utf8',timeout:15000,maxBuffer:2097152});
        const target=join(dir,path);mkdirSync(dirname(target),{recursive:true});
        writeFileSync(target,src,{mode:0o600});
      }
      const load=async p=>import(pathToFileURL(join(dir,p)).href);
      const {verifyDistinctJpegSources}=await load(files[0][1]);
      const {proposeDemandConcurrentControl}=await load(files[1][1]);
      const {auditDemandConcurrentExposureCandidates}=await load(files[2][1]);
      const {planUntrustedBciAuditAppend}=await load(files[4][1]);
      // PORTFOLIO_CURRENT_HEAD_CONTENT_DEMAND_TO_SHARED_BCI_20261028_V1
      // New worker-owned measurement/order contracts are exercised together with
      // the unchanged shared BCI append planner. All evidence remains untrusted.
      const {proposeContentMeasurementRevision}=await load('lib/content/measurement-revision.mjs');
      const {auditDemandOrderExposureCandidates}=await load('lib/demand/concurrent-order-candidate-audit.ts');
      const media=verifyDistinctJpegSources([jpeg()],{expectedWidth:2,expectedHeight:2});
      assert.equal(media.status,'JPEG_SOURCE_STRUCTURE_VERIFIED_ONLY');
      assert.equal(media.images[0].decodedPixelIntegrityVerified,false);
      assert.equal(media.images[0].providerByteIdentityVerified,false);
      assert.equal(media.images[0].approvalVerified,false);
      assert.equal(media.publishedVerified,false);
      const proposal=proposeDemandConcurrentControl({tenantId,product:'demand',
        pilotProduct:'bros_sell',metaAccountId:'act_123456789',campaignId:'123456789',
        hypothesis:'Synthetic educational offer-clarity experiment, not executed.',
        action:'LANDING_PAGE_TEST',
        treatmentChange:'Synthetic alternative offer explanation, not published.',
        primaryKpi:'verified_paid_orders',plannedStart:'2026-10-29',
        plannedEnd:'2026-11-04',preRegisteredAt:'2026-10-27T07:00:00Z',
        evidenceCandidateIds:['meta_ads:sha256:'+'a'.repeat(64)],
        assignmentUnit:'CONSENTED_LANDING_VISITOR',
        assignmentMethod:'STICKY_RANDOM_50_50_PROPOSED',
        controlExperience:'UNCHANGED_EXISTING_LANDING_PAGE',
        analysisPolicy:'INTENTION_TO_TREAT',maxIncrementalSpendMinor:0});
      const event=(id,digest,kind,arm)=>({eventId:id,
        experimentCandidateId:proposal.candidateId,tenantId,product:'demand',
        visitorDigest:digest,kind,arm,observedAt:'2026-10-29T04:00:00Z',
        consentRecorded:true});
      const a='a'.repeat(64),b='b'.repeat(64);
      const events=[event('assign:a',a,'assignment','control'),
        event('expose:a',a,'exposure','control'),
        event('assign:b',b,'assignment','treatment'),
        event('expose:b',b,'exposure','treatment')];
      const exposure=auditDemandConcurrentExposureCandidates(proposal,events);
      assert.equal(exposure.structuralConsistency,true);
      assert.equal(exposure.status,'UNATTESTED_STRUCTURAL_REVIEW');
      assert.equal(exposure.candidateId,
        auditDemandConcurrentExposureCandidates(proposal,[...events].reverse()).candidateId);
      // Latest DEMAND duplicate-visitor replay canonicalization must preserve
      // BCI evidence identity and findings independent of provider page order.
      const repeated={...events[0],eventId:'assign:a:repeat',
        observedAt:'2026-10-29T04:00:01Z'};
      const duplicated=[...events,repeated];
      const dupForward=auditDemandConcurrentExposureCandidates(proposal,duplicated);
      const dupReverse=auditDemandConcurrentExposureCandidates(proposal,
        [...duplicated].reverse());
      assert.equal(dupForward.candidateId,dupReverse.candidateId);
      assert.deepEqual(dupForward.findings,dupReverse.findings);
      assert.equal(dupForward.structuralConsistency,false);
      assert.ok(dupForward.findings.includes('DUPLICATE_VISITOR_ASSIGNMENT'));
      assert.equal(dupForward.verifiedPaidOrders,null);
      assert.equal(dupForward.outcomeVerified,false);
      const dupChain=chain('demand',dupForward.candidateId);
      const dupPlan=planUntrustedBciAuditAppend(
        {tenantId,product:'demand'},[],dupChain);
      assert.equal(dupPlan.toInsert.length,8);
      assert.equal(dupPlan.providerAttested,false);
      assert.equal(dupPlan.persisted,false);
      for(const key of ['ownerApprovalVerified','providerEvidenceAttested',
        'experimentExecutedVerified','outcomeVerified','learningVerified',
        'causalInferenceEligible','executionAllowed'])
        assert.equal(exposure[key],false,key);
      assert.equal(exposure.verifiedCacMinor,null);

      // Same UTC measurement instant with alternate precision must not create
      // a second CONTENT learning identity or verified BCI evidence.
      const measurementScope={tenantId,product:'content',instanceId:'sell-internal',
        contentId:'seller-lesson-001',postId:'buffer-post-123',
        channelService:'instagram',channelId:'ig123',asOf:'2026-10-27T12:00:00Z'};
      const metrics=(views,reach)=>({
        impressions:null,reach,views,reactions:0,comments:null,shares:null,
        clicks:null,saves:null,follows:null});
      const measuredBase={schemaVersion:1,...measurementScope,status:'MEASURED',
        providerAttestedByModule:false,flags:[],format:'image',assetCount:2,
        nativeUrl:'https://www.instagram.com/p/ABC123/',
        sentAt:'2026-10-27T10:00:00.000Z'};
      delete measuredBase.asOf;
      const prior={...measuredBase,metricsUpdatedAt:'2026-10-27T10:30:00.000Z',
        measurementAgeSeconds:1800,metrics:metrics(6,4)};
      const later={...measuredBase,metricsUpdatedAt:'2026-10-27T11:00:00.000Z',
        measurementAgeSeconds:3600,metrics:metrics(7,5)};
      const measuredCandidate=proposeContentMeasurementRevision(prior,later,measurementScope);
      assert.equal(measuredCandidate.status,'CANDIDATE_UNATTESTED');
      assert.equal(measuredCandidate.learningVerified,false);
      assert.equal(measuredCandidate.executionAllowed,false);
      const equivalent={...later,sentAt:'2026-10-27T10:00:00Z',
        metricsUpdatedAt:'2026-10-27T11:00:00Z'};
      assert.equal(proposeContentMeasurementRevision(prior,equivalent,measurementScope).candidateId,
        measuredCandidate.candidateId);
      assert.equal(proposeContentMeasurementRevision(later,equivalent,measurementScope).status,
        'NO_NEW_SNAPSHOT');
      assert.throws(()=>proposeContentMeasurementRevision(later,
        {...equivalent,metrics:metrics(99,5)},measurementScope),
        /CONFLICTING_PROVIDER_SNAPSHOT/);
      const measuredPlan=planUntrustedBciAuditAppend({tenantId,product:'content'},[],
        chain('content',measuredCandidate.candidateId));
      assert.equal(measuredPlan.toInsert.length,8);
      assert.equal(measuredPlan.providerAttested,false);
      assert.equal(measuredPlan.persisted,false);

      // Coercible order identity/event values cannot create a valid DEMAND
      // order→exposure candidate or an authenticated BCI learning.
      const order={eventId:'checkout:a',experimentCandidateId:proposal.candidateId,
        tenantId,product:'demand',pilotProduct:'bros_sell',visitorDigest:a,
        orderCandidateKey:'demand:hitpay-candidate:sha256:'+'c'.repeat(64),
        orderIdentityDigest:'e'.repeat(64),arm:'control',
        observedAt:'2026-10-29T06:00:00Z'};
      const orderAudit=auditDemandOrderExposureCandidates(proposal,events,[order]);
      assert.equal(orderAudit.status,'UNATTESTED_ORDER_EXPOSURE_JOIN');
      assert.equal(orderAudit.structuralConsistency,true);
      assert.equal(orderAudit.verifiedPaidOrders,null);
      assert.equal(orderAudit.hitpaySettlementVerified,false);
      assert.equal(orderAudit.attributionVerified,false);
      assert.equal(orderAudit.learningVerified,false);
      assert.throws(()=>auditDemandOrderExposureCandidates(proposal,events,
        [{...order,orderIdentityDigest:['e'.repeat(64)]}]),
        /Invalid BROS DEMAND order exposure candidates/);
      assert.throws(()=>auditDemandOrderExposureCandidates(proposal,events,
        [{...order,eventId:['checkout:a']}]),
        /Invalid BROS DEMAND order exposure candidates/);
      const orderPlan=planUntrustedBciAuditAppend({tenantId,product:'demand'},[],
        chain('demand',orderAudit.candidateId));
      assert.equal(orderPlan.toInsert.length,8);
      assert.equal(orderPlan.providerAttested,false);
      assert.equal(orderPlan.persisted,false);

      assert.equal(exposure.causalLift,null);
      const content=chain('content','content:jpeg:sha256:'+media.images[0].sha256);
      const demand=chain('demand',exposure.candidateId);
      for(const [product,records] of [['content',content],['demand',demand]]){
        const scope={tenantId,product};
        const plan=planUntrustedBciAuditAppend(scope,[],records);
        assert.equal(plan.toInsert.length,8);
        assert.equal(plan.structurallyLinkedLearnings,1);
        for(const key of ['authenticated','providerAttested','persisted'])
          assert.equal(plan[key],false,key);
        const replay=planUntrustedBciAuditAppend(scope,records,records);
        assert.equal(replay.toInsert.length,0);
        assert.equal(replay.replayedIds.length,8);
        assert.equal(replay.persisted,false);
        assert.throws(()=>planUntrustedBciAuditAppend(scope,[],[
          {...records[0],verification:'verified'},...records.slice(1)]),
          /Invalid BCI audit append/);
      }
      assert.throws(()=>planUntrustedBciAuditAppend(
        {tenantId,product:'demand'},[],content),/Invalid BCI evidence lineage/);
      assert.throws(()=>planUntrustedBciAuditAppend(
        {tenantId,product:'content'},[],demand),/Invalid BCI evidence lineage/);
      assert.throws(()=>planUntrustedBciAuditAppend(
        {tenantId:'44444444-4444-4444-8444-444444444444',product:'content'},
        [],content),/Invalid BCI evidence lineage/);
    }finally{rmSync(dir,{recursive:true,force:true,maxRetries:8,retryDelay:150});}
  });
}
