import test from 'node:test';
import assert from 'node:assert/strict';
import {previewHistoricalCampaignPlan} from '../lib/content/neon-content-legacy-plan-preview.ts';
import {ContentGenerationRejected} from '../lib/content/neon-content-generation-contract.ts';

const historic={
 strategy:{positioning:'Owner-led content',core_message:'Teach one principle',
  offer_angle:'Practical planning',platform_strategy:['Facebook','TikTok']},
 angles:[{title:'Pain point',hook:'Why does this stall?',reason:'Workflow gaps'}],
 scripts:[{title:'Post 1',hook:'Common issue',body:'One simple fix',cta:'Save this'}],
 scenes:[{scene_number:1,duration_seconds:10,visual_prompt:'Desk and whiteboard',
  motion_prompt:'Slow pan',narration:'Try a workflow',dialogue:''}],
 visuals:[{title:'Board',prompt:'Natural planning image'}],
 captions:{facebook:'Facebook education',instagram:'Instagram advice',tiktok:'TikTok explanation'},
 publish_plan:[
  {day:1,platform:'Facebook',content_type:'educational',objective:'Awareness'},
  {day:2,platform:'TikTok, Instagram, Facebook',content_type:'short-form',objective:'Interest'},
 ]
};
test('legacy caption map and multi-platform schedule stay fully visible but read-only',()=>{
 const before=JSON.stringify(historic);
 const preview=previewHistoricalCampaignPlan(historic);
 assert.equal(preview.original_format,'legacy');
 assert.equal(preview.readOnly,true);
 assert.equal(preview.readyForGeneration,false);
 assert.deepEqual(preview.warnings,['legacy_caption_map','combined_platform_label']);
 assert.deepEqual(preview.plan.captions,[
  {platform:'facebook',caption:'Facebook education'},
  {platform:'instagram',caption:'Instagram advice'},
  {platform:'tiktok',caption:'TikTok explanation'}
 ]);
 assert.deepEqual(preview.plan.publish_plan[1].platforms,['tiktok','instagram','facebook']);
 assert.equal(preview.plan.publish_plan[1].original_platform_label,'TikTok, Instagram, Facebook');
 assert.equal(preview.plan.publish_plan.length,2);
 assert.equal(JSON.stringify(historic),before,'Never rewrite source records');
});
test('strict current caption arrays and single-platform plan read without warnings',()=>{
 const source={...historic,
  captions:[{platform:'facebook',caption:'Educational caption'}],
  publish_plan:[{day:1,platform:'Facebook',content_type:'post',objective:'Awareness'}]
 };
 const view=previewHistoricalCampaignPlan(source);
 assert.equal(view.original_format,'current');
 assert.deepEqual(view.warnings,[]);
 assert.deepEqual(view.plan.publish_plan[0].platforms,['facebook']);
 assert.equal(view.readyForGeneration,false);
});
test('malformed legacy formats and unknown platforms are rejected, never guessed',()=>{
 for(const bad of [
  {...historic,captions:{facebook:''}},
  {...historic,captions:{other:'Should not map'}},
  {...historic,captions:{facebook:22}},
  {...historic,publish_plan:[{day:1,platform:'TikTok,unknown',content_type:'post',objective:'goal'}]},
  {...historic,publish_plan:[{day:1,platform:'TikTok,tiktok',content_type:'post',objective:'goal'}]},
  {...historic,publish_plan:[{day:0,platform:'TikTok',content_type:'post',objective:'goal'}]},
  {...historic,strategy:{...historic.strategy,positioning:''}},
  {...historic,job_secret:'unexpected'},
  {...historic,scenes:[{...historic.scenes[0],scene_number:3}]},
 ])assert.throws(()=>previewHistoricalCampaignPlan(bad),ContentGenerationRejected);
});
test('prototype keys and captions with unsupported structures are forbidden',()=>{
 for(const raw of [
  null, [], {captions:['surprise']},
  {...historic,captions:{facebook:{text:'not-a-string'}}},
  {...historic,publish_plan:[{...historic.publish_plan[0],credit_delta:5}]},
 ])assert.throws(()=>previewHistoricalCampaignPlan(raw),ContentGenerationRejected);
});
