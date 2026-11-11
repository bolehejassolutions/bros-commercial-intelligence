import test from 'node:test';
import assert from 'node:assert/strict';
import {buildContentCampaignView} from '../lib/content/neon-content-campaign-view.ts';
import {buildContentPublishPreview} from '../lib/content/neon-content-publish-preview.ts';

test('upstream campaign view rejects all normalized caption collisions',()=>{
 const input={captions:[
  {platform:'Facebook',caption:'First'},
  {platform:' facebook ',caption:'Second'},
  {platform:'TikTok',caption:'Valid'}
 ],publish_plan:[{day:1,platform:'Facebook'},{day:2,platform:'TikTok'}]};
 const snapshot=structuredClone(input);
 assert.deepEqual(buildContentCampaignView(input).captions,[{platform:'tiktok',caption:'Valid'}]);
 assert.deepEqual(buildContentPublishPreview(input).map(row=>row.caption),[null,'Valid']);
 assert.deepEqual(input,snapshot);
});

test('unique historical caption map remains readable',()=>{
 const view=buildContentCampaignView({captions:{' Facebook ':'Valid'}});
 assert.deepEqual(view.captions,[{platform:'facebook',caption:'Valid'}]);
});
