import test from 'node:test';
import assert from 'node:assert/strict';
import {projectBufferContentObservation, proposeContentNextStep} from '../lib/content/buffer-observation.mjs';

// Sanitized, provider-observed Buffer 28 Oct TikTok PHOTO carousel metric shape.
// IDs and URLs are synthetic; this is not authenticated provider ingestion.
const scope={product:'content',tenantId:'tenant-internal',instanceId:'sell-pilot',
  contentId:'content-001',channelService:'tiktok',channelId:'channel-001',
  expectedAssetCount:2,asOf:'2026-10-28T14:00:00.000Z'};
const post={
  id:'post-tiktok-001',status:'sent',channelService:'tiktok',channelId:'channel-001',
  sentAt:'2026-10-28T10:12:20.231Z',
  externalLink:'https://www.tiktok.com/@seller.example/video/7701657614647643412',
  assets:[
    {type:'image',source:'https://media.example.com/slide-1.jpg'},
    {type:'image',source:'https://media.example.com/slide-2.jpg'}
  ],
  text:'Panduan ringkas untuk penjual.',metadata:{isAiGenerated:true},
  metricsUpdatedAt:'2026-10-28T12:43:43.363Z',
  metrics:[
    {type:'views',name:'Video Views',unit:'count',value:78},
    {type:'reach',name:'Reach',unit:'count',value:0},
    {type:'reactions',name:'Reactions',unit:'count',value:0}
  ]
};
test('real-provider-shaped TikTok PHOTO Video Views label is held without erasing observed 78',()=>{
  const o=projectBufferContentObservation(post,scope);
  assert.equal(o.format,'image');
  assert.equal(o.metrics.views,78);
  assert.equal(o.metrics.reach,0);
  assert.equal(o.status,'REVIEW_REQUIRED');
  assert.ok(o.flags.includes('IMAGE_POST_VIDEO_VIEW_METRIC_SEMANTICS_REVIEW'));
  assert.equal(proposeContentNextStep([o]).reason,'EVIDENCE_QA_REVIEW');
  assert.equal(o.providerAttestedByModule,false);
});
test('ordinary photo Views and actual video Video Views are not falsely flagged',()=>{
  const photo=projectBufferContentObservation({...post,metrics:[
    {...post.metrics[0],name:'Views'},...post.metrics.slice(1)]},scope);
  assert.equal(photo.status,'MEASURED');
  assert.ok(!photo.flags.includes('IMAGE_POST_VIDEO_VIEW_METRIC_SEMANTICS_REVIEW'));
  const video=projectBufferContentObservation({...post,assets:post.assets.map(a=>({...a,type:'video'}))},scope);
  assert.equal(video.status,'MEASURED');
  assert.equal(video.format,'video');
  assert.ok(!video.flags.includes('IMAGE_POST_VIDEO_VIEW_METRIC_SEMANTICS_REVIEW'));
});
test('pre-SENT metric snapshot remains unmeasured and does not invent a learning candidate',()=>{
  const o=projectBufferContentObservation({...post,metricsUpdatedAt:'2026-10-28T09:53:08.430Z'},scope);
  assert.equal(o.status,'REVIEW_REQUIRED');
  assert.equal(o.metrics.views,null);
  assert.ok(o.flags.includes('METRICS_PRECEDE_SENT'));
  assert.equal(proposeContentNextStep([o]).executionAllowed,false);
});
