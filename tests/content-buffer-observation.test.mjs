import test from "node:test";
import assert from "node:assert/strict";
import {projectBufferContentObservation as project,proposeContentNextStep as next,inspectContentSourceToSentReferences as inspect,buildContentBciEvidenceHandoff as handoff, classifyContentApprovalProvenance} from "../lib/content/buffer-observation.mjs";
const scope={tenantId:"tenant-A",product:"content",instanceId:"sell-internal",contentId:"florist-001",channelService:"instagram",channelId:"ig123",expectedAssetCount:2};
const post={id:"post123",status:"sent",channelService:"instagram",channelId:"ig123",sentAt:"2026-10-22T05:00:56.507Z",externalLink:"https://www.instagram.com/p/ABC/",assets:[{type:"image",source:"https://a.example/1.png"},{type:"image",source:"https://a.example/2.png"}],text:"Situasi rekaan / ilustrasi AI",metadata:{isAiGenerated:true},metricsUpdatedAt:"2026-10-25T15:34:40.061Z",metrics:[{type:"views",unit:"count",value:7},{type:"reach",unit:"count",value:4},{type:"reactions",unit:"count",value:0}]};
const make=(p={},s={})=>project({...post,...p},{...scope,...s});
test("SENT provider snapshot preserves zero vs unknown and no provider attestation",()=>{const o=make();assert.equal(o.status,"MEASURED");assert.equal(o.metrics.views,7);assert.equal(o.metrics.reactions,0);assert.equal(o.metrics.clicks,null);assert.equal(o.providerAttestedByModule,false)});
test("draft and scheduled are not published",()=>{for(const status of ["draft","scheduled"])assert.equal(make({status}).status,"NOT_SENT")});
test("tenant/product and channel scope are enforced",()=>{assert.throws(()=>make({}, {product:"demand"}),/INVALID_TRUSTED_SCOPE/);assert.throws(()=>make({channelId:"other"}),/CHANNEL_SCOPE_MISMATCH/)});
test("missing native SENT URL is held",()=>assert.equal(make({externalLink:null}).status,"REVIEW_REQUIRED"));
test("stale metrics are not promoted to zero",()=>{const o=make({metricsUpdatedAt:"2026-10-21T00:00:00.000Z"});assert.equal(o.status,"REVIEW_REQUIRED");assert.equal(o.metrics.views,null)});
test("no metric snapshot is unknown",()=>{const o=make({metricsUpdatedAt:null,metrics:null});assert.equal(o.status,"SENT_UNMEASURED");assert.equal(o.metrics.views,null)});
test("invalid calendar and duplicate metrics fail closed",()=>{assert.equal(make({metricsUpdatedAt:"2026-02-30T15:00:00Z"}).status,"REVIEW_REQUIRED");assert.equal(make({metrics:[...post.metrics,{type:"views",unit:"count",value:99}]}).status,"REVIEW_REQUIRED")});
test("invalid counts and asset count are held",()=>{for(const value of [-1,2.5])assert.equal(make({metrics:[{type:"views",unit:"count",value}]}).status,"REVIEW_REQUIRED");assert.equal(make({assets:[post.assets[0]]}).status,"REVIEW_REQUIRED")});
test("AI caption/native metadata conflict triggers review",()=>{const o=make({metadata:{isAiGenerated:false}});assert.equal(o.status,"REVIEW_REQUIRED");assert.equal(next([o]).reason,"AI_DISCLOSURE_REVIEW")});
test("native URL must be HTTPS on matching channel",()=>{assert.equal(make({externalLink:"https://www.tiktok.com/@a/video/1"}).status,"REVIEW_REQUIRED");assert.equal(make({externalLink:"http://www.instagram.com/p/a"}).status,"REVIEW_REQUIRED")});
test("learning rejects cross tenant and duplicate posts",()=>{const o=make();assert.throws(()=>next([o,{...o,tenantId:"tenant-B",postId:"post456"}]),/CROSS_SCOPE/);assert.throws(()=>next([o,o]),/DUPLICATE_POST/)});
test("cross-platform views cannot be compared as a winner",()=>{const o=make();assert.equal(next([o,{...o,postId:"post456",channelService:"tiktok"}]).reason,"NO_SAME_CHANNEL_PAIR")});
test("same channel candidate is nonexecuting and noncausal",()=>{const o=make();const r=next([o,{...o,postId:"post456"}]);assert.equal(r.reason,"SAME_CHANNEL_CANDIDATES");assert.equal(r.executionAllowed,false);assert.equal(r.causalLiftProven,false)});

test("empty and unsupported metric snapshots remain unmeasured rather than zero",()=>{
  for(const metrics of [[],[{type:"engagementRate",unit:"percentage",value:1}]]) {
    const o=make({metrics});assert.equal(o.status,"SENT_UNMEASURED");assert.equal(o.metrics.views,null);
  }
});
test("measurement age derives from SENT timestamp",()=>{
  const o=make();assert.equal(o.measurementAgeSeconds,Math.floor((Date.parse(post.metricsUpdatedAt)-Date.parse(post.sentAt))/1000));
});
test("unequal cumulative measurement windows are not comparable",()=>{
  const a=make(),b=make({id:"post456",metricsUpdatedAt:"2026-10-23T15:34:40.061Z"});
  assert.equal(next([a,b]).reason,"NONCOMPARABLE_MEASUREMENT_WINDOWS_OR_FORMAT");
});
test("different account or format cannot be compared",()=>{
  const a=make();
  assert.equal(next([a,{...make({id:"post456"}),channelId:"other-ig"}]).reason,"NONCOMPARABLE_MEASUREMENT_WINDOWS_OR_FORMAT");
  assert.equal(next([a,{...make({id:"post789"}),format:"video"}]).reason,"NONCOMPARABLE_MEASUREMENT_WINDOWS_OR_FORMAT");
});
test("different measured metric types cannot be compared",()=>{
  const a=make({metrics:[{type:"views",unit:"count",value:7}]}),b=make({id:"post456",metrics:[{type:"clicks",unit:"count",value:2}]});
  assert.equal(next([a,b]).reason,"NONCOMPARABLE_MEASUREMENT_WINDOWS_OR_FORMAT");
});
test("near-equal windows remain only nonexecuting candidates",()=>{
  const a=make(),b=make({id:"post456",metricsUpdatedAt:"2026-10-25T16:20:40.061Z"});
  const r=next([a,b]);assert.equal(r.reason,"SAME_CHANNEL_CANDIDATES");assert.equal(r.executionAllowed,false);assert.equal(r.causalLiftProven,false);
});


// CONTENT_NATIVE_PERMALINK_AND_FUTURE_SNAPSHOT_GUARD_20261026: provider-shaped URLs from existing BROS SELL posts; synthetic scoped IDs.
test("realistic native IG/FB/TT permalinks are accepted and tracking is stripped",()=>{
  const ig=make({externalLink:"https://www.instagram.com/p/DeyLqz7EYPk/?utm_source=buffer#part"});
  assert.equal(ig.status,"MEASURED");
  assert.equal(ig.nativeUrl,"https://www.instagram.com/p/DeyLqz7EYPk/");
  const fb=make({channelService:"facebook",channelId:"fb123",externalLink:"https://www.facebook.com/967812963066089/posts/979084248605627"},{channelService:"facebook",channelId:"fb123"});
  assert.equal(fb.status,"MEASURED");
  const tt=make({channelService:"tiktok",channelId:"tt123",externalLink:"https://www.tiktok.com/@bros.sell/video/7699352537861737735?utm_source=7103819247981182978"},{channelService:"tiktok",channelId:"tt123"});
  assert.equal(tt.status,"MEASURED");
  assert.equal(tt.nativeUrl,"https://www.tiktok.com/@bros.sell/video/7699352537861737735");
});
test("homepages profiles login and off-platform lookalikes are not SENT proof",()=>{
  for(const url of [
    "https://www.instagram.com/",
    "https://www.instagram.com/accounts/login/",
    "https://www.instagram.com/bros.sell/",
    "https://www.instagram.com.evil.example/p/DeyLqz7EYPk/",
    "https://user:pass@www.instagram.com/p/DeyLqz7EYPk/",
    "https://www.instagram.com/p/ABC%2Ffake/"
  ]){
    const o=make({externalLink:url});
    assert.equal(o.status,"REVIEW_REQUIRED",url);
    assert.equal(o.nativeUrl,null,url);
  }
});
test("trusted asOf rejects future SENT and metric snapshots without inventing zero",()=>{
  const asOf="2026-10-26T14:00:00.000Z";
  const good=make({}, {asOf});assert.equal(good.status,"MEASURED");
  const futureSent=make({sentAt:"2026-10-27T01:00:00.000Z",metricsUpdatedAt:null,metrics:null},{asOf});
  assert.equal(futureSent.status,"REVIEW_REQUIRED");
  assert.ok(futureSent.flags.includes("SENT_IN_FUTURE"));
  const futureMetrics=make({metricsUpdatedAt:"2026-10-27T01:00:00.000Z"},{asOf});
  assert.equal(futureMetrics.status,"REVIEW_REQUIRED");
  assert.ok(futureMetrics.flags.includes("METRICS_IN_FUTURE"));
  assert.throws(()=>make({}, {asOf:"2026-02-30T14:00:00.000Z"}),/INVALID_TRUSTED_OBSERVATION_TIME/);
});

// CONTENT_PROVIDER_SCOPE_URL_GUARD_20261027_0054: synthetic negative regression fixtures only.
test("missing channel identity cannot pass even when both sides omit channelId",()=>{
  assert.throws(()=>make({channelId:undefined},{channelId:undefined}),/INVALID_TRUSTED_SCOPE/);
  assert.throws(()=>make({channelId:""},{channelId:""}),/INVALID_TRUSTED_SCOPE/);
});
test("attacker-controlled social subdomains cannot serve as native SENT permalinks",()=>{
  for(const url of ["https://evil.instagram.com/p/ABC/","https://mimic.www.instagram.com/p/ABC/","https://cdn.instagram.com/p/ABC/"]){
    const o=make({externalLink:url});
    assert.equal(o.status,"REVIEW_REQUIRED",url);
    assert.equal(o.nativeUrl,null,url);
  }
});
test("malformed or credential-bearing asset links require review",()=>{
  for(const source of ["https://","https://user:pass@drive.google.com/a.png","https://drive.google.com/a.png#fragment","https://drive.google.com:444/a.png","http://drive.google.com/a.png"]){
    const o=make({assets:[{type:"image",source},post.assets[1]]});
    assert.equal(o.status,"REVIEW_REQUIRED",source);
    assert.ok(o.flags.includes("ASSET_EVIDENCE_MISMATCH"),source);
  }
});

// CONTENT_IG_FRESH_METRICS_LEARNING_6ADCA7AD_20261026: synthetic replay of observed provider-shaped snapshot.
test("fresh post-SENT metrics yield evidence-linked, noncausal next action",()=>{
  const o=make({id:"post-fresh",sentAt:"2026-10-26T01:02:51.262Z",
    metricsUpdatedAt:"2026-10-26T14:32:54.244Z",
    metrics:[{type:"views",unit:"count",value:6},{type:"reach",unit:"count",value:4}]},
    {asOf:"2026-10-26T15:00:00.000Z"});
  assert.equal(o.status,"MEASURED");
  const r=next([o]);
  assert.equal(r.reason,"INSUFFICIENT_MEASURED_POSTS");
  assert.equal(r.nextAction,"COLLECT_COMPARABLE_SAME_CHANNEL_MEASUREMENT");
  assert.equal(r.evidenceStatus,"UNATTESTED_PROVIDER_PROJECTION");
  assert.deepEqual(r.evidence.map(x=>[x.postId,x.views,x.reach,x.providerAttestedByModule]),[["post-fresh",6,4,false]]);
  assert.equal(r.evidence[0].nativeUrl,"https://www.instagram.com/p/ABC/");
  assert.equal(r.executionAllowed,false);assert.equal(r.causalLiftProven,false);
});
test("unequal-age measured posts produce evidence, not a performance winner",()=>{
  const a=make({id:"post-old",sentAt:"2026-10-22T05:00:56.507Z",
    metricsUpdatedAt:"2026-10-26T14:32:54.245Z"});
  const b=make({id:"post-new",sentAt:"2026-10-26T01:02:51.262Z",
    metricsUpdatedAt:"2026-10-26T14:32:54.244Z",
    metrics:[{type:"views",unit:"count",value:6},{type:"reach",unit:"count",value:4}]});
  const r=next([a,b]);
  assert.equal(r.reason,"NONCOMPARABLE_MEASUREMENT_WINDOWS_OR_FORMAT");
  assert.equal(r.evidence.length,2);
  assert.deepEqual(r.evidence.map(x=>x.postId),["post-new","post-old"]);
  assert.equal(r.nextAction,"COLLECT_COMPARABLE_SAME_CHANNEL_MEASUREMENT");
  assert.equal(r.causalLiftProven,false);
});
test("review-required observations cannot become learning evidence",()=>{
  const held=make({metadata:{isAiGenerated:false}});
  const r=next([held]);
  assert.equal(r.reason,"AI_DISCLOSURE_REVIEW");
  assert.equal(r.nextAction,"REVIEW_AI_DISCLOSURE");
  assert.deepEqual(r.evidence,[]);
});


// CONTENT_SOURCE_TO_SENT_REFERENCE_GATE_20261027_0250: synthetic PNG QA digest fixture + actual provider-shaped JPEG metadata.
const sourceUrls=["https://drive.google.com/uc?id=source1&export=download","https://drive.google.com/uc?id=source2&export=download"];
const sourceQa={status:"SOURCE_BYTES_STRUCTURALLY_VERIFIED",distinctFileHashes:true,distinctPixelHashes:true,
  images:[
    {format:"PNG",width:1080,height:1350,bytes:1751408,sha256:"a".repeat(64),pixelSha256:"b".repeat(64),structuralIntegrity:"CRC_AND_DEFLATE_VALID"},
    {format:"PNG",width:1080,height:1350,bytes:1790827,sha256:"c".repeat(64),pixelSha256:"d".repeat(64),structuralIntegrity:"CRC_AND_DEFLATE_VALID"}
  ]};
const providerAssets=sourceUrls.map(source=>({type:"image",source,mimeType:"image/jpeg"}));
test("actual Buffer-shaped JPEG metadata does not attest original PNG bytes",()=>{
  const o=inspect({...post,assets:providerAssets},scope,sourceQa,sourceUrls);
  assert.equal(o.status,"REVIEW_REQUIRED");
  assert.ok(o.flags.includes("PROVIDER_MEDIA_FORMAT_NOT_SOURCE_PNG"));
  assert.equal(o.providerByteIdentityVerified,false);
  assert.equal(o.approvalVerified,false);
  assert.equal(o.executionAllowed,false);
  assert.deepEqual(o.sourceFileSha256,["a".repeat(64),"c".repeat(64)]);
});
test("matching PNG references are still untrusted, not approved or provider byte-attested",()=>{
  const o=inspect({...post,assets:providerAssets.map(a=>({...a,mimeType:"image/png"}))},scope,sourceQa,sourceUrls);
  assert.equal(o.status,"SOURCE_REFERENCES_MATCHED_UNATTESTED");
  assert.equal(o.sourceBytesRevalidatedByModule,false);
  assert.equal(o.providerAttestedByModule,false);
  assert.equal(o.providerByteIdentityVerified,false);
});
test("swapped media references, missing assets and malformed QA fail closed",()=>{
  const swapped=inspect({...post,assets:[providerAssets[1],providerAssets[0]]},scope,sourceQa,sourceUrls);
  assert.equal(swapped.status,"REVIEW_REQUIRED");
  assert.ok(swapped.flags.includes("SOURCE_PROVIDER_REFERENCE_MISMATCH"));
  const missing=inspect({...post,assets:[providerAssets[0]]},scope,sourceQa,sourceUrls);
  assert.ok(missing.flags.includes("SOURCE_ASSET_COUNT_MISMATCH"));
  assert.throws(()=>inspect(post,scope,{...sourceQa,images:[{...sourceQa.images[0],sha256:"not-a-hash"},sourceQa.images[1]]},sourceUrls),/INVALID_SOURCE_QA_EVIDENCE/);
  assert.throws(()=>inspect(post,scope,sourceQa,["http://invalid.test",sourceUrls[1]]),/INVALID_SOURCE_REFERENCE_MANIFEST/);
});
test("scheduled media cannot become SENT through matching source references",()=>{
  const o=inspect({...post,status:"scheduled",assets:providerAssets},scope,sourceQa,sourceUrls);
  assert.equal(o.status,"NOT_SENT");
});


// CONTENT_BCI_HANDOFF_V1_20261027: product adapter contract only, no provider or BCI authentication.
test("BCI handoff keeps provider projection unverified, null distinct from zero",()=>{
  const e=handoff(make(),scope,"2026-10-26T17:00:00.000Z");
  assert.equal(e.product,"content");
  assert.equal(e.provenance.provider,"buffer");
  assert.equal(e.provenance.completeness,"unverified");
  assert.equal(e.metrics.reactions,0);
  assert.equal(e.metrics.clicks,null);
  assert.ok(e.unknowns.includes("SHARED_BCI_AUDIT_NOT_WRITTEN"));
  assert.ok(e.evidenceId.startsWith("content-buffer-"));
});
test("BCI handoff deduplicates repeated provider snapshots while tracking real revisions",()=>{
  const time="2026-10-26T17:00:00.000Z",o=make();
  const a=handoff(o,scope,time);
  const replay=handoff(o,scope,"2026-10-26T17:01:00.000Z");
  assert.equal(handoff(o,scope,time).evidenceId,a.evidenceId);
  assert.equal(replay.evidenceId,a.evidenceId,"collection-time-only retry must not create duplicate BCI evidence");
  assert.notEqual(replay.provenance.collectedAt,a.provenance.collectedAt,"collection time remains auditable");
  assert.notEqual(handoff({...o,nativeUrl:"https://www.instagram.com/p/DEF/"},scope,time).evidenceId,a.evidenceId,"native permalink is part of source identity");
  const revisedTime="2026-10-25T15:35:40.061Z";
  assert.notEqual(handoff({...o,metricsUpdatedAt:revisedTime,measurementAgeSeconds:Math.floor((Date.parse(revisedTime)-Date.parse(o.sentAt))/1000)},scope,time).evidenceId,a.evidenceId,"provider metric timestamp revision is distinct");
  assert.notEqual(handoff(make({metrics:[{type:"views",unit:"count",value:8},{type:"reach",unit:"count",value:4},{type:"reactions",unit:"count",value:0}]}),scope,time).evidenceId,a.evidenceId);
  assert.notEqual(handoff(make({metrics:[{type:"views",unit:"count",value:7},{type:"reach",unit:"count",value:4},{type:"reactions",unit:"count",value:1}]}),scope,time).evidenceId,a.evidenceId);
});
test("BCI handoff fails closed on cross-tenant, cross-product, spoofed attestation and review",()=>{
  const time="2026-10-26T17:00:00.000Z",o=make();
  assert.throws(()=>handoff(o,{...scope,tenantId:"other"},time),/SCOPE/);
  assert.throws(()=>handoff(o,{...scope,product:"demand"},time),/SCOPE/);
  assert.throws(()=>handoff({...o,providerAttestedByModule:true},scope,time),/SCOPE/);
  assert.throws(()=>handoff(make({status:"scheduled"}),scope,time),/SCOPE/);
  assert.throws(()=>handoff(make({metadata:{isAiGenerated:false}}),scope,time),/SCOPE|METRICS/);
});
test("BCI handoff rejects forged freshness, native URL, metric values and age",()=>{
  const time="2026-10-26T17:00:00.000Z",o=make();
  assert.throws(()=>handoff(o,scope,"2026-10-21T00:00:00.000Z"),/PROVENANCE/);
  assert.throws(()=>handoff({...o,nativeUrl:"https://fake.instagram.com/p/ABC/"},scope,time),/PROVENANCE/);
  assert.throws(()=>handoff({...o,nativeUrl:null},scope,time),/PROVENANCE/);
  assert.throws(()=>handoff({...o,metrics:{...o.metrics,views:-1}},scope,time),/METRICS/);
  assert.throws(()=>handoff({...o,measurementAgeSeconds:0},scope,time),/STATUS/);
});
test("BCI handoff preserves SENT but unmeasured as unknown, not a zero",()=>{
  const o=make({metricsUpdatedAt:null,metrics:null});
  const e=handoff(o,scope,"2026-10-26T17:00:00.000Z");
  assert.equal(e.provenance.windowEnd,null);
  assert.equal(e.metrics.views,null);
  assert.ok(e.unknowns.includes("MEASUREMENT_UNAVAILABLE"));
});


// CONTENT_APPROVAL_BINDING_CANDIDATE_20261027_0748: synthetic, non-authorizing contract tests.
const approvalScope={product:"content",tenantId:"tenant-A",instanceId:"pilot-A",
  contentId:"content-A",contentVersionId:"version-1",channelId:"channel-A",
  asOf:"2026-10-27T00:00:00.000Z"};
const approvalManifest={contentSha256:"a".repeat(64),assetSha256:["b".repeat(64),"c".repeat(64)]};
const approvalEvent={schemaVersion:1,authorityType:"content_specific",
  eventId:"approval-event-001",decision:"approved",reviewerPrincipalId:"reviewer-001",
  tenantId:"tenant-A",instanceId:"pilot-A",contentId:"content-A",
  contentVersionId:"version-1",channelId:"channel-A",
  contentSha256:"a".repeat(64),assetSha256:["b".repeat(64),"c".repeat(64)],
  approvedAt:"2026-10-26T10:00:00.000Z",recordedAt:"2026-10-26T10:01:00.000Z",
  auditRef:"audit-001"};
test("conditional owner policy and missing event are never content approval",()=>{
  const p=classifyContentApprovalProvenance({authorityType:"owner_conditional_policy",
    policyRef:"22Oct2026"},approvalScope,approvalManifest);
  assert.equal(p.status,"POLICY_ONLY");
  assert.equal(p.approvalVerified,false);
  assert.equal(p.executionAllowed,false);
  assert.equal(classifyContentApprovalProvenance(null,approvalScope,approvalManifest).status,"NO_APPROVAL_EVENT");
});
test("content-bound candidate is deterministic but never authenticated or executable",()=>{
  const a=classifyContentApprovalProvenance(approvalEvent,approvalScope,approvalManifest);
  const b=classifyContentApprovalProvenance({...approvalEvent},approvalScope,approvalManifest);
  assert.equal(a.status,"CONTENT_BOUND_CANDIDATE_UNATTESTED");
  assert.equal(a.candidateId,b.candidateId);
  assert.equal(a.approvalVerified,false);
  assert.equal(a.executionAllowed,false);
  assert.equal(a.providerAttested,false);
});
test("cross-tenant/version/channel and swapped or changed media fail closed",()=>{
  for(const k of ["tenantId","instanceId","contentId","contentVersionId","channelId"])
    assert.throws(()=>classifyContentApprovalProvenance({...approvalEvent,[k]:"other"},
      approvalScope,approvalManifest),/SCOPE_MISMATCH/);
  for(const assetSha256 of [["c".repeat(64),"b".repeat(64)],["b".repeat(64),"d".repeat(64)]])
    assert.throws(()=>classifyContentApprovalProvenance({...approvalEvent,assetSha256},
      approvalScope,approvalManifest),/INVALID_CONTENT_APPROVAL_RECORD/);
  assert.throws(()=>classifyContentApprovalProvenance({...approvalEvent,contentSha256:"f".repeat(64)},
    approvalScope,approvalManifest),/INVALID_CONTENT_APPROVAL_RECORD/);
});
test("forged trust claims, invalid time and duplicate manifest are rejected",()=>{
  for(const extra of [{approvalVerified:true},{authenticated:true},{accessToken:"secret"}])
    assert.throws(()=>classifyContentApprovalProvenance({...approvalEvent,...extra},
      approvalScope,approvalManifest),/INVALID_CONTENT_APPROVAL_RECORD/);
  assert.throws(()=>classifyContentApprovalProvenance({...approvalEvent,approvedAt:"2026-10-28T00:00:00.000Z"},
    approvalScope,approvalManifest),/INVALID_CONTENT_APPROVAL_TIMELINE/);
  assert.throws(()=>classifyContentApprovalProvenance(approvalEvent,approvalScope,
    {...approvalManifest,assetSha256:["b".repeat(64),"b".repeat(64)]}),/INVALID_CONTENT_APPROVAL_BINDING_SCOPE/);
});
