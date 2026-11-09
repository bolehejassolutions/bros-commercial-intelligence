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
