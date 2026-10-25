import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileBufferPublication } from '../lib/content/buffer-publication-evidence.ts';
const id='6add890e3d5b27036bb7b9c3';
const sha='a'.repeat(64);
const image={sha256:sha,detectedMime:'image/png',width:1080,height:1350,verification:'source_container_only',publishedBytesVerified:false};
const review={attestation:image,fullDecodeVerified:true,approved:true};
const post={id,channelService:'facebook',status:'sent',sentAt:'2026-10-25T13:00:49.633Z',externalLink:'https://www.facebook.com/post',assets:[{mimeType:'image/jpeg',image:{width:1080,height:1350}}],metrics:[{type:'impressions',value:1},{type:'clicks',value:0}],metricsUpdatedAt:'2026-10-25T17:43:10.476Z'};
const make=(changes={},reviews=[review])=>({expectedPostId:id,expectedChannel:'facebook',sourceReviews:reviews,bufferPost:{...post,...changes}});
test('SENT plus source QA and provider metrics permits observational learning, never published-byte claim',()=>{
 const r=reconcileBufferPublication(make());
 assert.equal(r.providerStatus,'sent');assert.equal(r.readyForObservationalLearning,true);
 assert.equal(r.providerMediaBytesVerified,false);assert.deepEqual(r.warnings,['asset_mime_mismatch']);
 assert.equal(r.metrics.impressions,1);assert.equal(r.metrics.clicks,0);
 assert.equal(r.attribution,'provider_observation_only');
});
test('missing approval/full decode prevents learning despite SENT',()=>{
 const r=reconcileBufferPublication(make({},[{...review,approved:false,fullDecodeVerified:false}]));
 assert.equal(r.readyForObservationalLearning,false);
 assert.ok(r.warnings.includes('source_not_approved'));
 assert.ok(r.warnings.includes('source_not_fully_decoded'));
});
test('scheduled is not SENT and missing metrics is not zero',()=>{
 const r=reconcileBufferPublication(make({status:'scheduled',sentAt:null,metrics:undefined}));
 assert.equal(r.providerStatus,'not_sent');assert.equal(r.metrics,null);
 assert.equal(r.readyForObservationalLearning,false);
});
test('missing provider timestamp and asset count mismatch fail closed for learning',()=>{
 const r=reconcileBufferPublication(make({sentAt:'bad',assets:[]}));
 assert.ok(r.warnings.includes('invalid_sent_timestamp'));
 assert.ok(r.warnings.includes('asset_count_mismatch'));
 assert.equal(r.readyForObservationalLearning,false);
});
test('rejects mismatched post ID or channel',()=>{
 assert.throws(()=>reconcileBufferPublication(make({id:'f'.repeat(24)})));
 assert.throws(()=>reconcileBufferPublication(make({channelService:'tiktok'})));
});
test('TikTok AI disclosure mismatch is explicit, not rewritten',()=>{
 const t={...post,channelService:'tiktok',text:'Situasi rekaan. Ilustrasi AI.',metadata:{isAiGenerated:false},assets:[{mimeType:'image/png',image:{width:1080,height:1350}}]};
 const r=reconcileBufferPublication({expectedPostId:id,expectedChannel:'tiktok',sourceReviews:[review],bufferPost:t});
 assert.ok(r.warnings.includes('ai_disclosure_mismatch'));
 assert.equal(r.readyForObservationalLearning,false);
});
test('rejects conflicting/invalid metrics, retains unknown rather than inventing zero',()=>{
 assert.throws(()=>reconcileBufferPublication(make({metrics:[{type:'views',value:-1}]})));
 assert.throws(()=>reconcileBufferPublication(make({metrics:[{type:'views',value:1},{type:'views',value:2}]})));
 assert.equal(reconcileBufferPublication(make({metricsUpdatedAt:null})).metrics,null);
});
test('missing QA is not successful QA',()=>{
 const r=reconcileBufferPublication(make({},[]));
 assert.ok(r.warnings.includes('missing_source_qa'));
 assert.equal(r.readyForObservationalLearning,false);
});
