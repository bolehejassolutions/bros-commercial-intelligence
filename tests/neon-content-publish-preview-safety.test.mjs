import test from 'node:test';
import assert from 'node:assert/strict';
import {buildContentPublishPreview} from '../lib/content/neon-content-publish-preview.ts';

test('known caption is shown but never implies verified media or publishing approval',()=>{
 const [row]=buildContentPublishPreview({captions:{facebook:'Natural Malay copy'},
  publish_plan:[{day:1,platform:'facebook',content_type:'post',objective:'Teach'}]});
 assert.equal(row.caption,'Natural Malay copy');
 assert.equal(row.captionAvailable,true);
 assert.equal(row.mediaVerified,false);
 assert.equal(row.publishAuthorized,false);
 assert.ok(Object.isFrozen(row));
});
test('missing caption and legacy combined platform are explicitly incomplete',()=>{
 const rows=buildContentPublishPreview({captions:{tiktok:'Clip caption'},
  publish_plan:[{day:1,platform:'TikTok, Instagram',content_type:'video'},
   {day:2,platform:'instagram',content_type:'post'}]});
 assert.equal(rows.length,2);
 assert.equal(rows[0].caption,null);
 assert.equal(rows[0].captionAvailable,false);
 assert.equal(rows[1].captionAvailable,false);
 assert.ok(rows.every(row=>!row.mediaVerified&&!row.publishAuthorized));
});
test('invalid plan days are rejected by shared campaign view',()=>{
 assert.deepEqual(buildContentPublishPreview({publish_plan:[{day:91,platform:'facebook'}]}),[]);
 assert.deepEqual(buildContentPublishPreview({status:'draft'}),[]);
});
