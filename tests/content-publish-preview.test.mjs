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
test('invalid publish days are excluded and conflicting captions fail closed without affecting other platforms',()=>{
 const source={captions:[{platform:'facebook',caption:'First'},{platform:' facebook ',caption:'Second'},{platform:'tiktok',caption:'Independent'}],publish_plan:[{day:0,platform:'facebook'},{day:1,platform:'facebook'},{day:2,platform:'tiktok'}]};
 const snapshot=structuredClone(source);
 const rows=buildContentPublishPreview(source);
 assert.equal(rows.length,2);
 assert.equal(rows[0].caption,null);
 assert.equal(rows[0].captionAvailable,false);
 assert.equal(rows[1].caption,'Independent');
 assert.equal(rows[1].captionAvailable,true);
 assert.deepEqual(source,snapshot);
});
