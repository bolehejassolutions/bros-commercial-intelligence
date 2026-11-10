import test from 'node:test';
import assert from 'node:assert/strict';
import {buildContentPublishPreview} from '../lib/content/neon-content-publish-preview.ts';

test('duplicate normalized platform captions fail closed rather than selecting last',()=>{
 const rows=buildContentPublishPreview({
  captions:[{platform:'Facebook',caption:'First'},{platform:' facebook ',caption:'Second'}],
  publish_plan:[{day:1,platform:'Facebook',content_type:'post'}]
 });
 assert.equal(rows.length,1);
 assert.equal(rows[0].caption,null);
 assert.equal(rows[0].captionAvailable,false);
 assert.equal(rows[0].publishAuthorized,false);
});

test('caption collision does not suppress unrelated platform and does not mutate source',()=>{
 const campaign={
  captions:[{platform:'Facebook',caption:'First'},{platform:'FACEBOOK',caption:'Second'},{platform:'TikTok',caption:'Valid'}],
  publish_plan:[{day:2,platform:'TikTok',content_type:'video'},{day:1,platform:'Facebook',content_type:'post'}]
 };
 const original=structuredClone(campaign);
 const rows=buildContentPublishPreview(campaign);
 assert.deepEqual(rows.map(row=>[row.platform,row.caption]),[['Facebook',null],['TikTok','Valid']]);
 assert.deepEqual(campaign,original);
 assert.ok(rows.every(row=>row.mediaVerified===false&&row.publishAuthorized===false));
});
