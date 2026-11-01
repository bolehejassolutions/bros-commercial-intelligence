import test from 'node:test';
import assert from 'node:assert/strict';
import {buildContentTrendResearchPacket,proposeContentBriefFromTrend} from '../lib/content/trend-evidence.mjs';

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
test('rejects wrong host, platform, trackers, inaccessible pages and duplicate URLs',()=>{
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
