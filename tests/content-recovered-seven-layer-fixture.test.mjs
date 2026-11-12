import test from 'node:test';
import assert from 'node:assert/strict';
import {buildContentCampaignView} from '../lib/content/neon-content-campaign-view.ts';
import {summarizeContentCampaignInventory} from '../lib/content/neon-content-campaign-inventory.ts';

// Deterministic, non-billable fixture. Not an authenticated HTTP or PostgreSQL test.
// Explicitly distinguish draft text from generated image/video bytes.
test('recovered campaign presents planning layers and persisted content inventory without inventing media',()=>{
 const campaign={
  strategy:{positioning:'Malaysian sellers',core_message:'Explain clearly',
   offer_angle:'Practical system',platform_strategy:['TikTok education']},
  angles:[{title:'Buyer question',hook:'Customer asks why',reason:'Clarify value'}],
  captions:[{platform:'tiktok',caption:'A draft caption'}],
  publish_plan:[{day:1,platform:'tiktok',content_type:'educational',
   objective:'Explain a common misunderstanding'}]
 };
 const persisted=[
  {item:{id:'script-1',type:'script'},scenes:[]},
  {item:{id:'prompt-1',type:'visual_prompt'},scenes:[]},
  {item:{id:'scene-group-1',type:'video_scenes'},scenes:[{id:'scene-1'},{id:'scene-2'}]}
 ];
 const view=buildContentCampaignView(campaign);
 const inventory=summarizeContentCampaignInventory(persisted);
 assert.deepEqual(view.strategy.map(x=>x.label),
  ['Kedudukan jenama','Mesej utama','Sudut tawaran']);
 assert.equal(view.angles.length,1);
 assert.deepEqual(view.platformStrategy,['TikTok education']);
 assert.deepEqual(view.captions,[{platform:'tiktok',caption:'A draft caption'}]);
 assert.equal(view.publishPlan[0].platform,'tiktok');
 assert.equal(view.hasGeneratedContent,true);
 assert.deepEqual(inventory,{scripts:1,visualPrompts:1,sceneGroups:1,scenes:2,other:0});
 assert.equal('mediaBytes' in inventory,false);
 assert.equal('approved' in inventory,false);
 assert.equal('published' in view,false);
});
test('independent empty draft and empty persisted inventory never imply generated assets',()=>{
 const view=buildContentCampaignView({strategy:null,angles:[],captions:[],publish_plan:[]});
 const inventory=summarizeContentCampaignInventory([]);
 assert.equal(view.hasGeneratedContent,false);
 assert.deepEqual(inventory,{scripts:0,visualPrompts:0,sceneGroups:0,scenes:0,other:0});
});
