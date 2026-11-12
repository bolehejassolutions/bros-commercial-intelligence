import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeContentCampaignInventory} from '../lib/content/neon-content-campaign-inventory.ts';
test('recovered campaign inventory counts scripts, prompts and scenes without implying media',()=>{
 const rows=[
  {item:{id:'a',type:'script'},scenes:[]},
  {item:{id:'b',type:'visual_prompt'},scenes:[]},
  {item:{id:'c',type:'video_scenes'},scenes:[{id:'s1'},{id:'s2'},{id:'s2'}]},
  {item:{id:'c',type:'video_scenes'},scenes:[{id:'s1'}]},
  {item:{id:'d',type:'other'},scenes:[]}
 ];
 assert.deepEqual(summarizeContentCampaignInventory(rows),{scripts:1,visualPrompts:1,sceneGroups:1,scenes:2,other:1});
 assert.deepEqual(summarizeContentCampaignInventory([]),{scripts:0,visualPrompts:0,sceneGroups:0,scenes:0,other:0});
});
test('inventory deduplicates scene IDs across distinct items and ignores malformed rows',()=>{
 const rows=[
  {item:{id:'a',type:'script'},scenes:[{id:'shared'},null,{id:''},{id:17}]},
  {item:{id:'b',type:'video_scenes'},scenes:[{id:'shared'},{id:'unique'},{id:'unique'}]},
  {item:{id:'',type:'script'},scenes:[{id:'phantom'}]},
  {item:{id:'b',type:'video_scenes'},scenes:[{id:'phantom'}]},
  null,
  {item:{id:'c',type:'visual_prompt'},scenes:null}
 ];
 const result=summarizeContentCampaignInventory(rows);
 assert.deepEqual(result,{scripts:1,visualPrompts:1,sceneGroups:1,scenes:2,other:0});
 assert.equal(Object.isFrozen(result),true);
});
