import test from 'node:test';
import assert from 'node:assert/strict';
import {proposeContentMeasurementRevision as propose} from '../lib/content/measurement-revision.mjs';
const scope={product:'content',tenantId:'tenant-A',instanceId:'sell-internal',contentId:'content-1',postId:'post-1',channelService:'instagram',channelId:'channel-1',asOf:'2026-10-27T01:00:00.000Z'};
const metricNames=['impressions','reach','views','reactions','comments','shares','clicks','saves','follows'];
const metrics=(views=6,reach=4)=>Object.fromEntries(metricNames.map(k=>[k,k==='views'?views:k==='reach'?reach:k==='reactions'?0:null]));
const previous={schemaVersion:1,product:'content',tenantId:'tenant-A',instanceId:'sell-internal',contentId:'content-1',postId:'post-1',channelService:'instagram',channelId:'channel-1',status:'MEASURED',providerAttestedByModule:false,flags:[],format:'image',assetCount:2,nativeUrl:'https://www.instagram.com/p/ABC/',sentAt:'2026-10-26T01:00:00.000Z',metricsUpdatedAt:'2026-10-26T14:00:00.000Z',measurementAgeSeconds:46800,metrics:metrics()};
const current={...previous,metricsUpdatedAt:'2026-10-26T16:00:00.000Z',measurementAgeSeconds:54000,metrics:metrics(8,5)};
test('same-post later observation proposes noncausal learning candidate, never execution',()=>{const x=propose(previous,current,scope);assert.equal(x.status,'CANDIDATE_UNATTESTED');assert.equal(x.observedDeltas.views,2);assert.equal(x.observedDeltas.reactions,0);assert.equal(x.observedDeltas.clicks,null);assert.equal(x.causalLiftProven,false);assert.equal(x.learningVerified,false);assert.equal(x.executionAllowed,false);});
test('same provider snapshot repeated is stable and no new learning',()=>{const a=propose(previous,current,scope);assert.equal(propose(previous,{...current,metrics:{...current.metrics}},scope).candidateId,a.candidateId);const b=propose(current,{...current},scope);assert.equal(b.status,'NO_NEW_SNAPSHOT');assert.equal(b.reason,'IDENTICAL_PROVIDER_SNAPSHOT');});
test('cross-tenant, channel, content and post spoofing fail closed',()=>{for(const key of ['tenantId','instanceId','contentId','postId','channelId','channelService'])assert.throws(()=>propose(previous,{...current,[key]:'other'},scope),/CROSS_SCOPE/);});
// CONTENT_EQUIVALENT_UTC_REVISION_IDEMPOTENCY_20261027: provider timestamp precision is not a new snapshot.
test('equivalent UTC timestamp precision does not fabricate a new measurement revision',()=>{
  const equivalent={...current,sentAt:'2026-10-26T01:00:00Z',metricsUpdatedAt:'2026-10-26T16:00:00Z'};
  const replay=propose(current,equivalent,scope);
  assert.equal(replay.status,'NO_NEW_SNAPSHOT');
  assert.equal(replay.reason,'IDENTICAL_PROVIDER_SNAPSHOT');
  assert.equal(replay.candidateId,propose(current,current,scope).candidateId);
  assert.equal(propose(previous,equivalent,scope).candidateId,propose(previous,current,scope).candidateId);
  const oldEquivalent={...previous,sentAt:'2026-10-26T01:00:00Z',metricsUpdatedAt:'2026-10-26T14:00:00Z'};
  assert.equal(propose(oldEquivalent,current,scope).candidateId,propose(previous,current,scope).candidateId);
  assert.equal(replay.executionAllowed,false);
  assert.equal(replay.learningVerified,false);
});
test('equivalent UTC instant with changed counts still fails closed',()=>{
  const conflicting={...previous,metricsUpdatedAt:'2026-10-26T14:00:00Z',metrics:metrics(99,4)};
  assert.throws(()=>propose(previous,conflicting,scope),/CONFLICTING_PROVIDER_SNAPSHOT/);
});
test('same timestamp conflicting metrics and out-of-order snapshots fail',()=>{assert.throws(()=>propose(previous,{...previous,metrics:metrics(9,4)},scope),/CONFLICTING_PROVIDER_SNAPSHOT/);assert.throws(()=>propose(current,previous,scope),/OUT_OF_ORDER_MEASUREMENT/);});
test('counter regression or lost coverage requires review, never positive growth',()=>{const a=propose(previous,{...current,metrics:metrics(5,4)},scope);assert.equal(a.status,'REVIEW_REQUIRED');assert.equal(a.reason,'COUNTER_REGRESSION_REVIEW');const b=propose(previous,{...current,metrics:metrics(null,4)},scope);assert.equal(b.status,'REVIEW_REQUIRED');assert.equal(b.reason,'LOSS_OF_METRIC_COVERAGE');});
test('unknown-to-known is not counted as growth',()=>{const a=propose({...previous,metrics:metrics(null,4)},current,scope);assert.equal(a.observedDeltas.views,null);assert.equal(a.observedDeltas.reach,1);});
test('no overlapping metrics cannot claim learning',()=>{const a=propose({...previous,metrics:metrics(null,4)},{...current,metrics:metrics(8,null)},scope);assert.equal(a.status,'REVIEW_REQUIRED');assert.equal(a.reason,'LOSS_OF_METRIC_COVERAGE');});
test('scheduled, review, fake provider attestations and future timestamps fail closed',()=>{for(const patch of [{status:'NOT_SENT'},{status:'REVIEW_REQUIRED'},{providerAttestedByModule:true},{metricsUpdatedAt:'2026-10-28T00:00:00.000Z'}])assert.throws(()=>propose(previous,{...current,...patch},scope),/INVALID_MEASURED_OBSERVATION|INVALID_MEASUREMENT_TIMELINE/);});
test('source lineage changes cannot be treated as same-post measurement',()=>{for(const patch of [{sentAt:'2026-10-25T01:00:00.000Z',measurementAgeSeconds:140400},{nativeUrl:'https://www.instagram.com/p/XYZ/'},{format:'video'}])assert.throws(()=>propose(previous,{...current,...patch},scope),/LINEAGE_MISMATCH/);});


// CONTENT_NATIVE_MEASUREMENT_PERMALINK_PARITY_20261027: provider-shaped only, not authenticated.
test('measurement lineage rejects profile/login pages, shortlinks and noncanonical post URLs',()=>{
  const invalid=[
    'https://www.instagram.com/accounts/login/',
    'https://www.instagram.com/bros.sell/',
    'https://www.instagram.com/p/ABC/?utm_source=buffer',
    'https://www.instagram.com/p/ABC/#fragment',
    'https://evil.instagram.com/p/ABC/',
    'https://www.facebook.com/1234567890/posts/123456789012345/',
    'https://www.tiktok.com/@bros.sell/video/1234567890123456789'
  ];
  for(const nativeUrl of invalid)
    assert.throws(()=>propose({...previous,nativeUrl},{...current,nativeUrl},scope),
      /INVALID_NATIVE_POST_REFERENCE/,nativeUrl);
});
test('measurement lineage accepts only canonical supported FB, IG and TikTok post links',()=>{
  const valid=[
    ['instagram','https://www.instagram.com/p/ABC/'],
    ['facebook','https://www.facebook.com/1234567890/posts/123456789012345/'],
    ['tiktok','https://www.tiktok.com/@bros.sell/video/1234567890123456789']
  ];
  for(const [channelService,nativeUrl] of valid){
    const s={...scope,channelService};
    const a={...previous,channelService,nativeUrl};
    const b={...current,channelService,nativeUrl};
    const result=propose(a,b,s);
    assert.equal(result.status,'CANDIDATE_UNATTESTED');
    assert.equal(result.providerAttested,false);
    assert.equal(result.learningVerified,false);
    assert.equal(result.executionAllowed,false);
  }
});

// CONTENT_MEASUREMENT_REVISION_LIFETIME_AGE_GUARD_20261029:
// Real Buffer post timeline from 2019, refreshed in 2026; scoped IDs synthetic.
test('2019 lifetime metrics refreshed in 2026 are held from current pilot learning',()=>{
  const sentAt='2019-07-30T06:47:13.000Z';
  const first='2026-10-23T16:29:27.280Z';
  const second='2026-10-24T16:29:27.280Z';
  const age=timestamp=>Math.floor((Date.parse(timestamp)-Date.parse(sentAt))/1000);
  const old={...previous,sentAt,metricsUpdatedAt:first,measurementAgeSeconds:age(first),
    nativeUrl:'https://www.instagram.com/p/B0iAfc0JwWV/',metrics:metrics(0,0)};
  const later={...old,metricsUpdatedAt:second,measurementAgeSeconds:age(second),metrics:metrics(1,0)};
  const result=propose(old,later,scope);
  assert.equal(result.status,'REVIEW_REQUIRED');
  assert.equal(result.reason,'STALE_LIFETIME_MEASUREMENT_REVIEW');
  assert.equal(result.nextAction,'REVIEW_PROVIDER_METRICS');
  assert.equal(result.learningVerified,false);
  assert.equal(result.executionAllowed,false);
  assert.equal(propose(old,later,scope).candidateId,result.candidateId);
});
test('seven-day revision boundary permits candidate, one second later requires review',()=>{
  const sentAt='2026-10-20T01:00:00.000Z';
  const first='2026-10-26T23:00:00.000Z';
  const boundary='2026-10-27T01:00:00.000Z';
  const over='2026-10-27T01:00:01.000Z';
  const age=timestamp=>Math.floor((Date.parse(timestamp)-Date.parse(sentAt))/1000);
  const old={...previous,sentAt,metricsUpdatedAt:first,measurementAgeSeconds:age(first)};
  const atBoundary={...old,metricsUpdatedAt:boundary,measurementAgeSeconds:age(boundary),metrics:metrics(8,5)};
  const beyond={...atBoundary,metricsUpdatedAt:over,measurementAgeSeconds:age(over),metrics:metrics(9,5)};
  const at=propose(old,atBoundary,{...scope,asOf:over});
  assert.equal(at.status,'CANDIDATE_UNATTESTED');
  assert.equal(at.executionAllowed,false);
  const held=propose(atBoundary,beyond,{...scope,asOf:over});
  assert.equal(held.status,'REVIEW_REQUIRED');
  assert.equal(held.reason,'STALE_LIFETIME_MEASUREMENT_REVIEW');
});

test('old provider snapshots cannot become fresh pilot learning merely because post age is short',()=>{
  const sentAt='2026-10-20T01:00:00.000Z';
  const first='2026-10-21T01:00:00.000Z';
  const second='2026-10-21T03:00:00.000Z';
  const old={...previous,sentAt,metricsUpdatedAt:first,measurementAgeSeconds:86400};
  const later={...current,sentAt,metricsUpdatedAt:second,measurementAgeSeconds:93600};
  const fresh=propose(old,later,{...scope,asOf:'2026-10-22T01:00:00.000Z'});
  assert.equal(fresh.status,'CANDIDATE_UNATTESTED');
  const stale=propose(old,later,{...scope,asOf:'2026-10-30T01:00:00.000Z'});
  assert.equal(stale.status,'REVIEW_REQUIRED');
  assert.equal(stale.reason,'STALE_PROVIDER_SNAPSHOT_REVIEW');
  assert.equal(stale.nextAction,'REVIEW_PROVIDER_METRICS');
  assert.equal(stale.candidateId,fresh.candidateId);
  assert.equal(stale.learningVerified,false);
  assert.equal(stale.executionAllowed,false);
});
