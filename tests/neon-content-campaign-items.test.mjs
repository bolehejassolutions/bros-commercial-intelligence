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
test('conflicting duplicate scene IDs are suppressed rather than selecting an arbitrary occurrence',()=>{
 const rows=scopeContentCampaignItems(a,[{id:'one',campaign_id:a}],[
  {id:'same',content_item_id:'one',scene_number:5},
  {id:'same',content_item_id:'one',scene_number:1},
  {id:'other',content_item_id:'one',scene_number:2}
 ]);
 assert.deepEqual(rows[0].scenes.map(s=>s.id),['other']);
});
test('deduplication never mutates source scene array and leaves output frozen',()=>{
 const scenes=[{id:'same',content_item_id:'one',scene_number:3},{id:'same',content_item_id:'one',scene_number:1}];
 const rows=scopeContentCampaignItems(a,[{id:'one',campaign_id:a}],scenes);
 assert.equal(scenes[0].scene_number,3);
 assert.equal(rows[0].scenes.length,0);
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

test('scene ID claimed by different items is suppressed for both owners',()=>{
 const rows=scopeContentCampaignItems(a,[{id:'one',campaign_id:a},{id:'two',campaign_id:a}],[
  {id:'shared-scene',content_item_id:'one',scene_number:1},
  {id:'shared-scene',content_item_id:'two',scene_number:2},
  {id:'valid-one',content_item_id:'one',scene_number:3},
  {id:'valid-two',content_item_id:'two',scene_number:4}
 ]);
 assert.deepEqual(rows.map(r=>r.scenes.map(s=>s.id)),[['valid-one'],['valid-two']]);
});
test('same scene ID with conflicting scene numbers is suppressed',()=>{
 const rows=scopeContentCampaignItems(a,[{id:'one',campaign_id:a}],[
  {id:'replayed',content_item_id:'one',scene_number:4},
  {id:'replayed',content_item_id:'one',scene_number:1}
 ]);
 assert.equal(rows[0].scenes.length,0);
});

test('byte-identical scene replay is displayed once without changing the source',()=>{
 const scene={id:'replayed',content_item_id:'one',scene_number:1};
 const source=[scene,{...scene}];
 const rows=scopeContentCampaignItems(a,[{id:'one',campaign_id:a}],source);
 assert.deepEqual(rows[0].scenes.map(s=>s.id),['replayed']);
 assert.equal(source.length,2);
 assert.equal(Object.isFrozen(rows[0].scenes),true);
});

test('conflicting same-campaign item replay suppresses all copies and their scenes',()=>{
 const rows=scopeContentCampaignItems(a,[
  {id:'conflict',campaign_id:a,title:'Old script'},
  {id:'conflict',campaign_id:a,title:'Different script'},
  {id:'safe',campaign_id:a,title:'Stable script'}
 ],[
  {id:'scene-conflict',content_item_id:'conflict',scene_number:1},
  {id:'scene-safe',content_item_id:'safe',scene_number:1}
 ]);
 assert.deepEqual(rows.map(row=>row.item.id),['safe']);
 assert.deepEqual(rows[0].scenes.map(scene=>scene.id),['scene-safe']);
});
test('byte-identical item replay remains visible exactly once',()=>{
 const item={id:'same-item',campaign_id:a,title:'Verified replay'};
 const source=[item,{...item}];
 const rows=scopeContentCampaignItems(a,source,[{id:'scene',content_item_id:item.id}]);
 assert.deepEqual(rows.map(row=>row.item.id),['same-item']);
 assert.deepEqual(rows[0].scenes.map(scene=>scene.id),['scene']);
 assert.equal(source.length,2);
});

test('JSONB key-order changes do not suppress identical item and scene replays',()=>{
 const item={id:'jsonb',campaign_id:a,metadata:{z:1,a:{two:2,one:1}}};
 const replay={metadata:{a:{one:1,two:2},z:1},campaign_id:a,id:'jsonb'};
 const scene={id:'jsonb-scene',content_item_id:'jsonb',visual:{z:'last',a:'first'}};
 const sceneReplay={visual:{a:'first',z:'last'},content_item_id:'jsonb',id:'jsonb-scene'};
 const rows=scopeContentCampaignItems(a,[item,replay],[scene,sceneReplay]);
 assert.deepEqual(rows.map(row=>row.item.id),['jsonb']);
 assert.deepEqual(rows[0].scenes.map(row=>row.id),['jsonb-scene']);
});
test('nested JSONB value changes still suppress conflicting replay records',()=>{
 const rows=scopeContentCampaignItems(a,[
  {id:'changed',campaign_id:a,metadata:{nested:{value:'original'}}},
  {id:'changed',campaign_id:a,metadata:{nested:{value:'tampered'}}},
  {id:'safe',campaign_id:a}
 ],[{id:'scene',content_item_id:'changed'}]);
 assert.deepEqual(rows.map(row=>row.item.id),['safe']);
});
test('non-JSON and cyclic replay payloads fail closed without affecting valid items',()=>{
 const cycle={id:'cycle',campaign_id:a};cycle.self=cycle;
 const rows=scopeContentCampaignItems(a,[cycle,{id:'valid',campaign_id:a}],[]);
 assert.deepEqual(rows.map(row=>row.item.id),['valid']);
});
