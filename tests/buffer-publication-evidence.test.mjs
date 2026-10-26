import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileBufferPublication } from '../lib/content/buffer-publication-evidence.ts';
const id='6add890e3d5b27036bb7b9c3';
const sha='a'.repeat(64);
const image={sha256:sha,detectedMime:'image/png',width:1080,height:1350,verification:'source_container_only',publishedBytesVerified:false};
const source='https://drive.google.com/uc?export=download&id=trusted-image';
const review={attestation:image,fullDecodeVerified:true,approved:true,providerAssetSource:source};
const post={id,channelService:'facebook',status:'sent',sentAt:'2026-10-25T13:00:49.633Z',externalLink:'https://www.facebook.com/post',assets:[{source,mimeType:'image/jpeg',image:{width:1080,height:1350}}],metrics:[{type:'impressions',value:1},{type:'clicks',value:0}],metricsUpdatedAt:'2026-10-25T17:43:10.476Z'};
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
 const t={...post,channelService:'tiktok',text:'Situasi rekaan. Ilustrasi AI.',metadata:{isAiGenerated:false},assets:[{source,mimeType:'image/png',image:{width:1080,height:1350}}]};
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

test('identical dimensions and MIME cannot bind unapproved Buffer asset',()=>{
 const noBinding=reconcileBufferPublication(make({},[{...review,providerAssetSource:undefined}]));
 assert.equal(noBinding.readyForObservationalLearning,false);
 assert.ok(noBinding.warnings.includes('asset_source_unbound'));
 const substituted=reconcileBufferPublication(make({assets:[{...post.assets[0],source:'https://example.com/different.png'}]}));
 assert.equal(substituted.readyForObservationalLearning,false);
 assert.ok(substituted.warnings.includes('asset_source_mismatch'));
});
test('publisher source binding must be an exact safe HTTPS reference',()=>{
 for(const bad of ['http://drive.google.com/uc','https://user:pass@example.com/a','https://example.com/a#fragment','not-a-url',42])
   assert.throws(()=>reconcileBufferPublication(make({},[{...review,providerAssetSource:bad}])));
 const changedQuery=reconcileBufferPublication(make({assets:[{...post.assets[0],source:'https://drive.google.com/uc?id=trusted-image&export=download'}]}));
 assert.ok(changedQuery.warnings.includes('asset_source_mismatch'));
 assert.equal(changedQuery.readyForObservationalLearning,false);
});
