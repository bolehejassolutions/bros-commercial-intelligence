import test from "node:test";
import assert from "node:assert/strict";
import {projectBufferContentObservation as project,proposeContentNextStep as next} from "../lib/content/buffer-observation.mjs";
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
