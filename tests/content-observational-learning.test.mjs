import test from 'node:test';
import assert from 'node:assert/strict';
import { projectContentObservations } from '../lib/content/content-observational-learning.ts';
const tenant='123e4567-e89b-42d3-a456-426614174000';
const p={postId:'a'.repeat(24),channel:'facebook',provider:'buffer',providerStatus:'sent',
 providerSentAt:'2026-10-25T13:00:49.633Z',metricsUpdatedAt:'2026-10-25T17:43:10.476Z',
 metrics:{impressions:1,clicks:0},mediaSourceHashes:['b'.repeat(64)],
 sourceFullDecodeVerified:true,sourceEditorialApproved:true,providerMediaBytesVerified:false,
 warnings:['asset_mime_mismatch'],readyForObservationalLearning:true,attribution:'provider_observation_only'};
const make=(pub=p,extra={})=>({tenantId:tenant,product:'content',observedAt:'2026-10-26T00:00:00Z',publication:pub,...extra});
test('provider-reported SENT creates one scoped observational record without acquisition claims',()=>{
 const [x]=projectContentObservations([make()]);
 assert.equal(x.metrics.impressions,1);assert.equal(x.metrics.clicks,0);
 assert.equal(x.causalEffect,null);assert.equal(x.attributedSales,null);
 assert.equal(x.qualifiedLeads,null);assert.equal(x.providerMediaBytesVerified,false);
 assert.equal(x.verification,'provider_reported');
});
test('same provider snapshot is idempotent',()=>{
 assert.equal(projectContentObservations([make(),make()]).length,1);
});
test('conflicting replay of identical source key is rejected',()=>{
 assert.throws(()=>projectContentObservations([make(),make({...p,metrics:{impressions:2}})]));
});
test('not SENT, no QA, no approval and unavailable metrics are rejected',()=>{
 for(const patch of [{providerStatus:'not_sent'},{sourceFullDecodeVerified:false},
 {sourceEditorialApproved:false},{readyForObservationalLearning:false},{metrics:null}])
 assert.throws(()=>projectContentObservations([make({...p,...patch})]));
});
test('rejects future metrics or measurement before SENT',()=>{
 assert.throws(()=>projectContentObservations([make({...p,metricsUpdatedAt:'2026-10-27T00:00:00Z'})]));
 assert.throws(()=>projectContentObservations([make({...p,metricsUpdatedAt:'2026-10-24T00:00:00Z'})]));
});
test('cross-product and malformed tenant denied',()=>{
 assert.throws(()=>projectContentObservations([make(p,{product:'demand'})]));
 assert.throws(()=>projectContentObservations([make(p,{tenantId:'wrong'})]));
});
test('AI disclosure contradiction or missing source hash cannot be promoted to learning',()=>{
 assert.throws(()=>projectContentObservations([make({...p,warnings:['ai_disclosure_mismatch']})]));
 assert.throws(()=>projectContentObservations([make({...p,mediaSourceHashes:[]})]));
});
test('separate metric snapshots stay separate, never summed or interpreted as sales',()=>{
 const a=make(),b=make({...p,metricsUpdatedAt:'2026-10-25T20:00:00Z',metrics:{impressions:5,clicks:1}});
 const r=projectContentObservations([a,b]);assert.equal(r.length,2);
 assert.equal(r[0].attributedSales,null);assert.equal(r[1].attributedSales,null);
});
test('same provider post cannot switch channels within tenant',()=>{
 assert.throws(()=>projectContentObservations([make(),make({...p,channel:'instagram',metricsUpdatedAt:'2026-10-25T20:00:00Z'})]));
});
test('zero and finite fractional provider rates are retained, invalid metrics denied',()=>{
 assert.equal(projectContentObservations([make({...p,metrics:{clicks:0}})])[0].metrics.clicks,0);
 assert.throws(()=>projectContentObservations([make({...p,metrics:{clicks:-1}})]));
 assert.equal(projectContentObservations([make({...p,metrics:{engagementRate:1.89}})])[0].metrics.engagementRate,1.89);
 assert.throws(()=>projectContentObservations([make({...p,metrics:{clicks:Infinity}})]));
});
