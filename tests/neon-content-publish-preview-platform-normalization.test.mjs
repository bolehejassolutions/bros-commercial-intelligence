import test from 'node:test';
import assert from 'node:assert/strict';
import {buildContentPublishPreview} from '../lib/content/neon-content-publish-preview.ts';

test('historical caption labels with surrounding whitespace match one supported platform',()=>{
 const [row]=buildContentPublishPreview({
  captions:[{platform:'  Facebook  ',caption:'Baca dulu'}],
  publish_plan:[{day:1,platform:' FACEBOOK ',content_type:'post'}]
 });
 assert.equal(row.caption,'Baca dulu');
 assert.equal(row.captionAvailable,true);
 assert.equal(row.mediaVerified,false);
 assert.equal(row.publishAuthorized,false);
});

test('combined platform labels remain unmatched and cannot imply publication',()=>{
 const [row]=buildContentPublishPreview({
  captions:[{platform:'Facebook',caption:'Only for Facebook'}],
  publish_plan:[{day:1,platform:'Facebook, Instagram',content_type:'post'}]
 });
 assert.equal(row.caption,null);
 assert.equal(row.captionAvailable,false);
 assert.equal(row.publishAuthorized,false);
 assert.equal(row.mediaVerified,false);
});
