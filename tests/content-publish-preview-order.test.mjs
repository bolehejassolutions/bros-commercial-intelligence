import test from 'node:test';
import assert from 'node:assert/strict';
import {buildContentPublishPreview} from '../lib/content/neon-content-publish-preview.ts';

test('publish preview sorts by day, preserving same-day platform order and original source',()=>{
 const publish_plan=[
  {day:3,platform:'TikTok',content_type:'video'},
  {day:1,platform:'Facebook',content_type:'post'},
  {day:1,platform:'Instagram',content_type:'carousel'},
  {day:2,platform:'TikTok',content_type:'video'}
 ];
 const before=structuredClone(publish_plan);
 const rows=buildContentPublishPreview({publish_plan});
 assert.deepEqual(rows.map(row=>[row.day,row.platform]),[
  [1,'Facebook'],[1,'Instagram'],[2,'TikTok'],[3,'TikTok']
 ]);
 assert.deepEqual(publish_plan,before);
 assert.ok(Object.isFrozen(rows));
 assert.ok(rows.every(row=>row.publishAuthorized===false&&row.mediaVerified===false));
});

test('invalid days are excluded and unsupported platform captions are never inferred',()=>{
 const rows=buildContentPublishPreview({
  captions:[{platform:'Facebook',caption:'Valid FB only'}],
  publish_plan:[
   {day:2,platform:'Facebook, Instagram'},
   {day:0,platform:'Facebook'},
   {day:1,platform:'Facebook'}
  ]
 });
 assert.equal(rows.length,2);
 assert.deepEqual(rows.map(row=>row.day),[1,2]);
 assert.equal(rows[0].caption,'Valid FB only');
 assert.equal(rows[1].caption,null);
 assert.equal(rows[1].publishAuthorized,false);
});
