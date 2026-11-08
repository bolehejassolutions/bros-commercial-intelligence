import test from 'node:test';
import assert from 'node:assert/strict';
import {buildContentPublishPreview} from '../lib/content/neon-content-publish-preview.ts';
test('links historical caption map to matching publish day without publishing',()=>{
 const result=buildContentPublishPreview({captions:{facebook:'Legacy copy',tiktok:'Video copy'},publish_plan:[{day:2,platform:'Facebook',content_type:'static'},{day:3,platform:'tiktok',content_type:'video'}]});
 assert.deepEqual(result.map(x=>x.caption),['Legacy copy','Video copy']);
 assert.equal(result[0].day,2);
});
test('does not fabricate caption when plan has no matching platform',()=>{
 const [row]=buildContentPublishPreview({captions:{facebook:'A'},publish_plan:[{day:1,platform:'instagram'}]});
 assert.equal(row.caption,null);assert.equal(row.captionAvailable,false);
});
test('multi-platform legacy label never guesses caption',()=>{
 const [row]=buildContentPublishPreview({captions:{facebook:'A'},publish_plan:[{day:1,platform:'facebook, instagram'}]});
 assert.equal(row.caption,null);
});
test('invalid publish plan is excluded and duplicate caption rows use first valid entry',()=>{
 const rows=buildContentPublishPreview({captions:[{platform:'facebook',caption:'First'},{platform:'facebook',caption:'Second'}],publish_plan:[{day:0,platform:'facebook'},{day:1,platform:'facebook'}]});
 assert.equal(rows.length,1);assert.equal(rows[0].caption,'First');
});
