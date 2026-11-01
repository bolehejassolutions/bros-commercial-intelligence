import test from 'node:test';
import assert from 'node:assert/strict';
import {buildContentTrendResearchPacket,proposeContentBriefFromTrend,proposeContentTrendHookScriptReview} from '../lib/content/trend-evidence.mjs';

const metrics=()=>({views:null,likes:null,comments:0,shares:null,saves:null});
const record=(overrides={})=>({
  sourceId:'ig-001',platform:'instagram',url:'https://www.instagram.com/reel/CxABCDE12',
  publishedAt:'2026-10-25T08:00:00Z',observedAt:'2026-10-30T08:00:00Z',
  topic:'Pelanggan diam selepas harga',hookPattern:'Question interrupts expectation',
  visualStyle:'Realistic small seller scene',format:'video',metrics:metrics(),...overrides
});
const packet=(records=[
  record(),
  record({sourceId:'tt-001',platform:'tiktok',
    url:'https://www.tiktok.com/@seller.my/video/123456789123456789',
    metrics:{...metrics(),views:5000}}),
  record({sourceId:'r-001',platform:'reddit',
    url:'https://www.reddit.com/r/sales/comments/abc123/why_customers_stop',
    format:'text',metrics:{...metrics(),likes:30}})
])=>({schemaVersion:1,product:'content',tenantId:'tenant-A',
  instanceId:'instance-A',asOf:'2026-11-01T08:00:00Z',
  windowDays:30,records});
const instance=()=>({schemaVersion:1,product:'content',tenantId:'tenant-A',
  instanceId:'instance-A',brand:{displayName:'Example Brand',
    voice:'Helpful, accurate Malay',locale:'ms-MY',
    claimCandidates:[],blockedClaims:['Guaranteed income']},
  audience:{segment:'Small business sellers',needs:['Explain value before price']},
  goals:['Teach sales diagnostics'],
  channels:[{service:'instagram',channelId:'ig-A'}],
  policy:{requiresContentApproval:true,requiresIndependentMediaQa:true,
    requiresEvidenceForClaims:true}});
const proposal=()=>({briefId:'brief-001',revisionId:'rev-001',
  format:'single_image',assetCount:1,
  hook:'Harga dah diberi tetapi pelanggan diam?',
  hypothesis:'Explaining value may improve audience understanding',
  measurementQuestion:'Are saves present in comparable post-age windows?'});

test('cross-platform recurrence is a sample hypothesis and never a verified viral or sales claim',()=>{
  const p=buildContentTrendResearchPacket(packet());
  assert.equal(p.candidates.length,1);
  const c=p.candidates[0];
  assert.equal(c.observedSourceCount,3);
  assert.equal(c.observedPlatformCount,3);
  assert.equal(c.evidenceClass,'CROSS_PLATFORM_RECURRING');
  assert.equal(p.rankMeaning,'RECURRENCE_IN_SUPPLIED_SAMPLE_ONLY');
  for(const k of ['providerAuthenticated','demandVerified','viralityVerified',
    'exhaustivePlatformSearchVerified','viewMetricsComparableAcrossPlatforms',
    'executionAllowed','approvalVerified','customerSaasReady'])assert.equal(p[k],false);
  assert.equal(c.marketDemandVerified,false);
  assert.equal(p.records.find(x=>x.platform==='instagram').metrics.views,null);
  assert.equal(p.records.find(x=>x.platform==='tiktok').metrics.views,5000);
  assert.equal(p.records.find(x=>x.platform==='reddit').metrics.likes,30);
});
test('source order does not affect research identity or candidate IDs',()=>{
  const a=packet(),b=packet([...a.records].reverse());
  const p=buildContentTrendResearchPacket(a),q=buildContentTrendResearchPacket(b);
  assert.equal(p.packetId,q.packetId);
  assert.equal(p.candidates[0].candidateId,q.candidates[0].candidateId);
});
test('only observed single-channel samples retain single-platform uncertainty',()=>{
  const p=buildContentTrendResearchPacket(packet([record()]));
  assert.equal(p.candidates[0].evidenceClass,'SINGLE_PLATFORM_HYPOTHESIS');
  assert.equal(p.candidates[0].performanceRankingVerified,false);
});
test('rejects wrong host, platform, trackers, malformed locators and duplicate URLs',()=>{
  for(const url of [
    'http://instagram.com/reel/a','https://instagram.com/login',
    'https://instagram.com/reel/abc?utm=unsafe',
    'https://fakeinstagram.com/reel/abc',
    'https://instagram.com@evil.example/reel/abc']){
    const p=packet([record({url})]);
    assert.throws(()=>buildContentTrendResearchPacket(p),/SOURCE_URL|PLATFORM_URL/);
  }
  assert.throws(()=>buildContentTrendResearchPacket(packet([
    record(),record({sourceId:'other-id'})
  ])),/DUPLICATE_TREND_SOURCE/);
  assert.throws(()=>buildContentTrendResearchPacket(packet([
    record({platform:'reddit'})
  ])),/TREND_PLATFORM_URL_MISMATCH/);
});

test('rejects aliases of one native post even when source IDs and URL paths differ',()=>{
  for(const [platform,first,alias] of [
    ['instagram','https://instagram.com/reel/CxABCDE12','https://www.instagram.com/p/CxABCDE12/'],
    ['tiktok','https://tiktok.com/@first/video/123456789','https://www.tiktok.com/@renamed/video/123456789'],
    ['reddit','https://reddit.com/r/sales/comments/abc123/original_title','https://reddit.com/comments/ABC123/new_title']
  ]){
    assert.throws(()=>buildContentTrendResearchPacket(packet([
      record({platform,url:first}),record({platform,sourceId:'alias-002',url:alias})
    ])),/DUPLICATE_TREND_SOURCE/);
  }
});

test('packet snapshots and proposed brief provenance are deeply immutable',()=>{
  const p=buildContentTrendResearchPacket(packet());
  assert.throws(()=>{p.candidates[0].topic='Forged topic';},TypeError);
  assert.throws(()=>{p.records[0].metrics.views=999999;},TypeError);
  assert.throws(()=>{p.candidates[0].sourceUrls.push('https://evil.example');},TypeError);
  const plan=proposeContentBriefFromTrend(instance(),p,p.candidates[0].candidateId,
    {service:'instagram',channelId:'ig-A'},proposal());
  assert.throws(()=>{plan.sourceLinks[0]='https://evil.example';},TypeError);
  assert.throws(()=>{plan.brief.topic='Forged topic';},TypeError);
});

test('revalidates serialized packet provenance and derived claims before proposing a brief',()=>{
  const original=buildContentTrendResearchPacket(packet());
  for(const change of [
    p=>{p.candidates[0].topic='Forged topic';},
    p=>{p.candidates[0].sourceUrls[0]='https://evil.example';},
    p=>{p.candidates[0].observedSourceCount=999;},
    p=>{p.candidates[0].candidateId='forged-candidate';},
    p=>{p.records[0].metrics.views=999999;},
    p=>{p.packetId='forged-packet';},
    p=>{p.viralityVerified=true;},
    p=>{p.providerAuthenticated=true;},
    p=>{p.candidates[0].marketDemandVerified=true;},
    p=>{p.extraClaim=true;}
  ]){
    const p=JSON.parse(JSON.stringify(original));change(p);
    assert.throws(()=>proposeContentBriefFromTrend(instance(),p,p.candidates[0].candidateId,
      {service:'instagram',channelId:'ig-A'},proposal()),/INVALID_TREND_RESEARCH_PACKET|TREND_PACKET_INTEGRITY_MISMATCH/);
  }
  // JSON object-key order is irrelevant; source/candidate array order remains part of the snapshot.
  const reorder=v=>Array.isArray(v)?v.map(reorder):v&&typeof v==='object'
    ?Object.fromEntries(Object.entries(v).reverse().map(([k,x])=>[k,reorder(x)])):v;
  const p=reorder(JSON.parse(JSON.stringify(original)));
  assert.equal(proposeContentBriefFromTrend(instance(),p,p.candidates[0].candidateId,
    {service:'instagram',channelId:'ig-A'},proposal()).sourcePacketId,original.packetId);
});

test('rejects derived accessor fields without invoking them',()=>{
  const p=JSON.parse(JSON.stringify(buildContentTrendResearchPacket(packet())));
  let reads=0;
  Object.defineProperty(p.candidates[0],'topic',{enumerable:true,get(){reads++;return 'Forged topic';}});
  assert.throws(()=>proposeContentBriefFromTrend(instance(),p,p.candidates[0].candidateId,
    {service:'instagram',channelId:'ig-A'},proposal()),/TREND_PACKET_INTEGRITY_MISMATCH/);
  assert.equal(reads,0);
});
test('strict date, metric and unknown field constraints',()=>{
  assert.throws(()=>buildContentTrendResearchPacket(packet([
    record({publishedAt:'2025-10-01T00:00:00Z'})
  ])),/TREND_SOURCE_OUTSIDE_WINDOW/);
  assert.throws(()=>buildContentTrendResearchPacket(packet([
    record({observedAt:'2026-12-01T00:00:00Z'})
  ])),/TREND_SOURCE_OUTSIDE_WINDOW/);
  assert.throws(()=>buildContentTrendResearchPacket(packet([
    record({metrics:{...metrics(),views:-1}})
  ])),/INVALID_TREND_METRIC/);
  assert.throws(()=>buildContentTrendResearchPacket(packet([
    record({metrics:{...metrics(),impressions:300}})
  ])),/INVALID_TREND_METRICS/);
  assert.throws(()=>buildContentTrendResearchPacket({...packet(),providerVerified:true}),
    /INVALID_TREND_PACKET/);
  const p=packet();p.records=new Array(2);
  assert.throws(()=>buildContentTrendResearchPacket(p),/INVALID_TREND_RECORDS/);
});
test('preserves date-only publication precision without fabricating a UTC instant',()=>{
  const p=buildContentTrendResearchPacket(packet([record({publishedAt:'2026-10-20'})]));
  assert.equal(p.records[0].publishedAt,'2026-10-20');
  assert.equal(p.providerAuthenticated,false);
  assert.equal(p.viralityVerified,false);
  const result=proposeContentBriefFromTrend(instance(),JSON.parse(JSON.stringify(p)),
    p.candidates[0].candidateId,{service:'instagram',channelId:'ig-A'},proposal());
  assert.equal(result.executionAllowed,false);
});
test('date-only sources must fit wholly inside the observation and lookback bounds',()=>{
  for(const publishedAt of ['2026-10-02','2026-10-30','2026-11-01',
    '2026-02-30','2026-13-01','2026-10-2']){
    assert.throws(()=>buildContentTrendResearchPacket(packet([record({publishedAt})])),
      /TREND_SOURCE_OUTSIDE_WINDOW/);
  }
});
test('converts evidence only to review-required existing CONTENT plan, not publisher permission',()=>{
  const p=buildContentTrendResearchPacket(packet());
  const result=proposeContentBriefFromTrend(instance(),p,p.candidates[0].candidateId,
    {service:'instagram',channelId:'ig-A'},proposal());
  assert.equal(result.status,'TREND_BRIEF_REVIEW_REQUIRED');
  assert.equal(result.brief.topic,'Pelanggan diam selepas harga');
  assert.equal(result.sourceLinks.length,3);
  assert.equal(result.sourcePacketId,p.packetId);
  assert.equal(result.sourceBytesVerified,false);
  assert.equal(result.providerSentVerified,false);
  assert.equal(result.executionAllowed,false);
  assert.equal(result.trendProviderAuthenticated,false);
});
test('prevents cross-instance brief generation and unconfigured publisher channels',()=>{
  const p=buildContentTrendResearchPacket(packet());
  const config=instance();config.tenantId='tenant-B';
  assert.throws(()=>proposeContentBriefFromTrend(config,p,p.candidates[0].candidateId,
    {service:'instagram',channelId:'ig-A'},proposal()),/TREND_PACKET_SCOPE_MISMATCH/);
  assert.throws(()=>proposeContentBriefFromTrend(instance(),p,p.candidates[0].candidateId,
    {service:'tiktok',channelId:'tt-A'},proposal()),/CONTENT_CHANNEL_NOT_CONFIGURED/);
  assert.throws(()=>proposeContentBriefFromTrend(instance(),p,'nonexistent',
    {service:'instagram',channelId:'ig-A'},proposal()),/TREND_CANDIDATE_NOT_FOUND/);
});


test('short-form storyboard stays source-bound and nonexecuting, without pretending video exists',()=>{
  const p=buildContentTrendResearchPacket(packet());
  const script={
    scriptId:'script-001',revisionId:'script-rev-001',
    openingHook:proposal().hook,
    sellerSituation:'Penjual sudah memberi harga tetapi pelanggan belum menjawab.',
    diagnosticQuestion:'Adakah nilai tawaran telah dijelaskan sebelum harga?',
    valueExplanation:'Tunjukkan skop dan hasil yang relevan tanpa janji pendapatan.',
    sellerAction:'Tanya satu soalan untuk memahami keperluan pelanggan.',
    closingLine:'Jelaskan nilai dahulu, kemudian minta keputusan yang jelas.',
    shots:['Paparkan konteks perbualan tanpa maklumat peribadi.',
      'Paparkan soalan diagnosis dan tindakan penjual.']
  };
  const a=proposeContentTrendHookScriptReview(instance(),p,p.candidates[0].candidateId,
    {service:'instagram',channelId:'ig-A'},proposal(),script);
  const b=proposeContentTrendHookScriptReview(instance(),JSON.parse(JSON.stringify(p)),
    p.candidates[0].candidateId,{service:'instagram',channelId:'ig-A'},proposal(),script);
  assert.equal(a.scriptIntentId,b.scriptIntentId);
  assert.equal(a.planId,b.planId);
  assert.equal(a.sourceLinks.length,3);
  assert.equal(a.status,'SHORT_FORM_SCRIPT_REVIEW_REQUIRED');
  assert.equal(a.intentKind,'STORYBOARD_AND_SCRIPT_ONLY');
  for(const flag of ['providerTrendAuthenticated','sourceClaimsVerified',
    'scriptEditoriallyApproved','independentMediaBytesVerified','videoRendered',
    'providerCapabilityVerified','providerSentVerified','measurementVerified',
    'sharedBciAuditVerified','executionAllowed','customerSaasReady'])
    assert.equal(a[flag],false);
  assert.throws(()=>{a.script.shots.push('Injected scene');},TypeError);
  assert.throws(()=>{a.sourceLinks[0]='https://evil.example';},TypeError);
});
test('short-form script requires valid scope, exact brief hook and strict fields',()=>{
  const p=buildContentTrendResearchPacket(packet());
  const args=[instance(),p,p.candidates[0].candidateId,
    {service:'instagram',channelId:'ig-A'},proposal()];
  const valid={
    scriptId:'script-001',revisionId:'rev-001',openingHook:proposal().hook,
    sellerSituation:'Penjual sudah memberi harga tetapi pelanggan belum menjawab.',
    diagnosticQuestion:'Adakah nilai tawaran sudah dijelaskan kepada pelanggan?',
    valueExplanation:'Terangkan skop tawaran dan kaitkan dengan keperluan sebenar.',
    sellerAction:'Tanya satu soalan diagnosis sebelum mencadangkan tindakan.',
    closingLine:'Jelaskan dahulu sebelum meminta keputusan daripada pelanggan.',
    shots:['Paparkan masalah penjual dengan jelas.','Paparkan tindakan penjual yang spesifik.']
  };
  for(const change of [
    s=>{s.openingHook='Hook yang tidak sepadan dengan brief';},
    s=>{s.videoRendered=true;},
    s=>{s.shots=['Hanya satu adegan'];},
    s=>{s.shots[0]='';},
    s=>{s.scriptId='invalid id with spaces';}
  ]){
    const s=structuredClone(valid);change(s);
    assert.throws(()=>proposeContentTrendHookScriptReview(...args,s),
      /INVALID_TREND|TREND_SCRIPT_HOOK_BRIEF_MISMATCH/);
  }
  const forged=JSON.parse(JSON.stringify(p));forged.providerAuthenticated=true;
  assert.throws(()=>proposeContentTrendHookScriptReview(instance(),forged,
    p.candidates[0].candidateId,{service:'instagram',channelId:'ig-A'},proposal(),valid),
    /TREND_PACKET_INTEGRITY_MISMATCH/);
  const other=instance();other.instanceId='instance-B';
  assert.throws(()=>proposeContentTrendHookScriptReview(other,p,
    p.candidates[0].candidateId,{service:'instagram',channelId:'ig-A'},proposal(),valid),
    /TREND_PACKET_SCOPE_MISMATCH/);
});
