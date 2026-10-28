import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeBufferReadback} from '../scripts/content-buffer-observation-readback.mjs';
import {projectBufferContentObservation,proposeContentNextStep} from '../lib/content/buffer-observation.mjs';

// Privacy-minimized replay of actual read-only Buffer post shapes observed 28 Oct
// 2026 ~20:55 MYT. Post/channel IDs and media URLs below are synthetic substitutes;
// sent/metrics timestamps, counts, platform metadata and native URL formats reflect
// the provider response. This is NOT authenticated live ingestion or CONTENT SENT.
const scope=(service,channelId)=>({
  product:'content',tenantId:'tenant-pilot',instanceId:'sell-internal',
  contentId:'seller-education',channelService:service,channelId,
  expectedAssetCount:2,asOf:'2026-10-28T13:00:00.000Z'
});
const assets=prefix=>[0,1].map(i=>({
  type:'image',mimeType:'image/jpeg',source:`https://media.example.test/${prefix}-${i}.jpg`
}));
const igScope=scope('instagram','ig-pilot');
const ig={
  id:'ig-post-new',status:'sent',channelService:'instagram',channelId:'ig-pilot',
  sentAt:'2026-10-28T10:03:40.687Z',
  externalLink:'https://www.instagram.com/p/DfCK-3YIDRD/',
  assets:assets('ig'),text:'Ilustrasi AI',metadata:{isAiGenerated:true},
  metricsUpdatedAt:'2026-10-28T12:33:13.672Z',
  metrics:[
    {type:'views',value:0,unit:'count'},{type:'reach',value:0,unit:'count'},
    {type:'reactions',value:0,unit:'count'},{type:'comments',value:0,unit:'count'},
    {type:'engagementRate',value:0,unit:'percentage'}
  ]
};
const ttScope=scope('tiktok','tt-pilot');
const tt={
  id:'tt-post-new',status:'sent',channelService:'tiktok',channelId:'tt-pilot',
  sentAt:'2026-10-28T10:12:20.231Z',
  externalLink:'https://tiktok.com/@bros.sell/video/7701657614647643412',
  assets:assets('tt'),text:'Ilustrasi AI',metadata:{isAiGenerated:false},
  metricsUpdatedAt:'2026-10-28T12:43:43.363Z',
  metrics:[
    {type:'views',value:78,unit:'count'},{type:'reach',value:0,unit:'count'},
    {type:'reactions',value:0,unit:'count'},{type:'comments',value:0,unit:'count'},
    {type:'engagementRate',value:0,unit:'percentage'},
    {type:'totalTimeWatched',value:4.8,unit:'count'},
    {type:'averageTimeWatched',value:3.6,unit:'count'}
  ]
};

test('observed IG post-SENT zero is MEASURED, never fabricated as missing',()=>{
  const r=summarizeBufferReadback({post:ig,scope:igScope});
  assert.equal(r.status,'MEASURED');
  assert.equal(r.metrics.views,0);
  assert.equal(r.metrics.reach,0);
  assert.equal(r.metrics.clicks,null);
  assert.deepEqual(r.flags,[]);
  assert.ok(r.measurementAgeSeconds>8000);
  assert.equal(r.providerAuthenticated,false);
  assert.equal(r.contentPublisherVerified,false);
  assert.equal(r.learningVerified,false);
  assert.equal(r.bciAuditWritten,false);
  assert.equal(r.executionAllowed,false);
  assert.equal(r.sourceTrust,'UNATTESTED_CONNECTOR_RESPONSE');
  assert.equal(summarizeBufferReadback({post:{...ig},scope:{...igScope}}).snapshotFingerprint,r.snapshotFingerprint);
  assert.equal(JSON.stringify(r).includes('ig-pilot'),false);
  assert.equal(JSON.stringify(r).includes('seller-education'),false);
  assert.equal(JSON.stringify(r).includes('media.example.test'),false);
});

test('observed TikTok metrics do not override native AI-disclosure review hold',()=>{
  const r=summarizeBufferReadback({post:tt,scope:ttScope});
  assert.equal(r.status,'REVIEW_REQUIRED');
  assert.ok(r.flags.includes('AI_DISCLOSURE_MISMATCH'));
  assert.equal(r.metrics.views,78);
  assert.equal(r.metrics.reach,0);
  assert.equal(r.learningVerified,false);
  assert.equal(r.executionAllowed,false);
});

test('pre-SENT metrics timestamp cannot become zero-view measurement',()=>{
  const r=summarizeBufferReadback({post:{
    ...ig,metricsUpdatedAt:'2026-10-28T04:49:16.215Z'
  },scope:igScope});
  assert.equal(r.status,'REVIEW_REQUIRED');
  assert.ok(r.flags.includes('METRICS_PRECEDE_SENT'));
  assert.equal(r.metrics.views,null);
});

test('same-channel historical 6 views and new zero at unequal post ages are noncomparable',()=>{
  const old={...ig,id:'ig-post-old',
    externalLink:'https://www.instagram.com/p/De8Djl1oNGa/',
    sentAt:'2026-10-26T01:02:51.262Z',
    metricsUpdatedAt:'2026-10-28T12:33:13.673Z',
    assets:assets('old'),
    metrics:[{type:'views',value:6,unit:'count'},
      {type:'reach',value:4,unit:'count'},
      {type:'reactions',value:0,unit:'count'}]
  };
  const a=projectBufferContentObservation(ig,igScope);
  const b=projectBufferContentObservation(old,igScope);
  assert.equal(a.status,'MEASURED');
  assert.equal(b.status,'MEASURED');
  const next=proposeContentNextStep([a,b]);
  assert.equal(next.reason,'NONCOMPARABLE_MEASUREMENT_WINDOWS_OR_FORMAT');
  assert.equal(next.executionAllowed,false);
  assert.equal(next.causalLiftProven,false);
});

test('bad envelope and scope fail closed; redacted output cannot assert provider authentication',()=>{
  assert.throws(()=>summarizeBufferReadback({post:ig}),/INVALID_READBACK_ENVELOPE/);
  assert.throws(()=>summarizeBufferReadback({post:ig,scope:{...igScope,channelId:'other'}}),/CHANNEL_SCOPE_MISMATCH/);
  assert.throws(()=>summarizeBufferReadback({post:ig,scope:{...igScope,product:'demand'}}),/INVALID_TRUSTED_SCOPE/);
  assert.equal(Object.hasOwn(summarizeBufferReadback({post:ig,scope:igScope}),'nativeUrl'),false);
});
