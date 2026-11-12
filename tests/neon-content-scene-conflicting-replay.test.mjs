import test from 'node:test';
import assert from 'node:assert/strict';
import {scopeContentCampaignItems} from '../lib/content/neon-content-campaign-items.ts';

const campaign='11111111-1111-4111-8111-111111111111';
const item={id:'item-a',campaign_id:campaign,type:'video_scenes'};
test('identical duplicate scene replay is shown only once',()=>{
 const rows=scopeContentCampaignItems(campaign,[item],[
  {id:'scene-a',content_item_id:'item-a',scene_number:1,narration:'Verified'},
  {id:'scene-a',content_item_id:'item-a',scene_number:1,narration:'Verified'}
 ]);
 assert.equal(rows.length,1);
 assert.deepEqual(rows[0].scenes.map(s=>s.id),['scene-a']);
});
test('conflicting same-ID scene replay fails closed rather than showing first or last',()=>{
 const rows=scopeContentCampaignItems(campaign,[item],[
  {id:'scene-a',content_item_id:'item-a',scene_number:1,narration:'Original'},
  {id:'scene-a',content_item_id:'item-a',scene_number:1,narration:'Altered'},
  {id:'scene-b',content_item_id:'item-a',scene_number:2,narration:'Unchanged'}
 ]);
 assert.deepEqual(rows[0].scenes.map(s=>s.id),['scene-b']);
});
test('scene IDs claimed by two content items are excluded from both',()=>{
 const rows=scopeContentCampaignItems(campaign,[item,{id:'item-b',campaign_id:campaign}],[
  {id:'shared',content_item_id:'item-a',scene_number:1},
  {id:'shared',content_item_id:'item-b',scene_number:1}
 ]);
 assert.equal(rows.every(r=>r.scenes.length===0),true);
});
