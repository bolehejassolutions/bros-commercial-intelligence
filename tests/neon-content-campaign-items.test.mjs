import test from 'node:test';
import assert from 'node:assert/strict';
import {scopeContentCampaignItems} from '../lib/content/neon-content-campaign-items.ts';
const a='campaign-a',b='campaign-b';
test('campaign preview never includes other campaign items or their scenes',()=>{
 const rows=scopeContentCampaignItems(a,[{id:'one',campaign_id:a},{id:'two',campaign_id:b}],
 [{id:'s1',content_item_id:'one',scene_number:2},{id:'s2',content_item_id:'two',scene_number:1}]);
 assert.equal(rows.length,1);assert.deepEqual(rows[0].scenes.map(s=>s.id),['s1']);
});
test('scene numbers render in chronological order without mutating source',()=>{
 const scenes=[{id:'late',content_item_id:'one',scene_number:3},{id:'early',content_item_id:'one',scene_number:1},{id:'unknown',content_item_id:'one'}];
 const rows=scopeContentCampaignItems(a,[{id:'one',campaign_id:a}],scenes);
 assert.deepEqual(rows[0].scenes.map(s=>s.id),['early','late','unknown']);
 assert.equal(scenes[0].id,'late');
});
test('duplicate item identifiers do not duplicate rendered scene collections',()=>{
 const rows=scopeContentCampaignItems(a,[{id:'one',campaign_id:a},{id:'one',campaign_id:a}],
 [{id:'s1',content_item_id:'one'}]);assert.equal(rows.length,1);
});
test('orphan scenes and invalid campaign selection are not rendered',()=>{
 const rows=scopeContentCampaignItems(a,[{id:'one',campaign_id:a}],
 [{id:'orphan',content_item_id:'missing'}]);assert.equal(rows[0].scenes.length,0);
 assert.deepEqual(scopeContentCampaignItems('',[{id:'one',campaign_id:a}],[]),[]);
});
test('duplicate scene IDs display once and prefer earliest numbered occurrence',()=>{
 const rows=scopeContentCampaignItems(a,[{id:'one',campaign_id:a}],[
  {id:'same',content_item_id:'one',scene_number:5},
  {id:'same',content_item_id:'one',scene_number:1},
  {id:'other',content_item_id:'one',scene_number:2}
 ]);
 assert.deepEqual(rows[0].scenes.map(s=>s.id),['same','other']);
 assert.equal(rows[0].scenes[0].scene_number,1);
});
test('deduplication never mutates source scene array and leaves output frozen',()=>{
 const scenes=[{id:'same',content_item_id:'one',scene_number:3},{id:'same',content_item_id:'one',scene_number:1}];
 const rows=scopeContentCampaignItems(a,[{id:'one',campaign_id:a}],scenes);
 assert.equal(scenes[0].scene_number,3);
 assert.equal(rows[0].scenes.length,1);
 assert.equal(Object.isFrozen(rows[0].scenes),true);
});

test('ambiguous item IDs claimed by another campaign fail closed',()=>{
 const rows=scopeContentCampaignItems(a,[{id:'shared',campaign_id:a},{id:'shared',campaign_id:b},{id:'safe',campaign_id:a}],[
  {id:'ambiguous-scene',content_item_id:'shared',scene_number:1},
  {id:'safe-scene',content_item_id:'safe',scene_number:2}
 ]);
 assert.deepEqual(rows.map(row=>row.item.id),['safe']);
 assert.deepEqual(rows[0].scenes.map(scene=>scene.id),['safe-scene']);
});
test('repeated item IDs within the same campaign remain deduplicated',()=>{
 const rows=scopeContentCampaignItems(a,[{id:'one',campaign_id:a},{id:'one',campaign_id:a}],[{id:'scene',content_item_id:'one'}]);
 assert.equal(rows.length,1);assert.equal(rows[0].scenes.length,1);
});
