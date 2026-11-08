import test from 'node:test';
import assert from 'node:assert/strict';
import {parseContentWorkspaceDetail,ContentWorkspaceDetailInvalid} from '../lib/content/neon-content-workspace-detail-response.ts';
import {buildContentCampaignView} from '../lib/content/neon-content-campaign-view.ts';
import {buildContentPublishPreview} from '../lib/content/neon-content-publish-preview.ts';
const workspaceId='11111111-1111-4111-8111-111111111111';
const campaignId='22222222-2222-4222-8222-222222222222';
const scriptId='33333333-3333-4333-8333-333333333333';
const visualId='44444444-4444-4444-8444-444444444444';
const sceneId='55555555-5555-4555-8555-555555555555';
function fixture(){
 return {data:{
  workspace:{id:workspaceId,name:'Recovered workspace'},
  campaigns:[{id:campaignId,product_service:'BROS SELL',
   strategy:{positioning:'Seller education',core_message:'Explain before selling',offer_angle:'System thinking'},
   angles:[{title:'Buyer confusion',hook:'Why do prospects go silent?',reason:'Unclear value'}],
   captions:{facebook:'Explain the offer',tiktok:'Show the diagnosis'},
   publish_plan:[{day:1,platform:'facebook',content_type:'static',objective:'Education'},
    {day:2,platform:'tiktok',content_type:'video',objective:'Awareness'}]}],
  contentItems:[{id:scriptId,campaign_id:campaignId,type:'script',body:{hook:'A question',body:'Explain',cta:'Learn more'}},
   {id:visualId,campaign_id:campaignId,type:'visual_prompt',body:{prompt:'Natural seller scene'}}],
  scenes:[{id:sceneId,content_item_id:scriptId,scene_number:1,narration:'First scene',visual_prompt:'Seller at counter'}]
 }};
}
test('recovered seven-layer campaign flows through strict workspace parser to preview',()=>{
 const detail=parseContentWorkspaceDetail(fixture(),workspaceId);
 assert.equal(detail.workspace.id,workspaceId);
 assert.equal(detail.contentItems.length,2);
 assert.equal(detail.scenes[0].content_item_id,scriptId);
 const campaign=detail.campaigns[0];
 const view=buildContentCampaignView(campaign);
 assert.equal(view.strategy.length,3);
 assert.equal(view.angles.length,1);
 assert.equal(view.captions.length,2);
 assert.equal(view.publishPlan.length,2);
 assert.equal(detail.contentItems.find(x=>x.type==='script')?.body.hook,'A question');
 assert.equal(detail.contentItems.find(x=>x.type==='visual_prompt')?.body.prompt,'Natural seller scene');
 assert.equal(detail.scenes[0].visual_prompt,'Seller at counter');
 const preview=buildContentPublishPreview(campaign);
 assert.deepEqual(preview.map(x=>x.caption),['Explain the offer','Show the diagnosis']);
 assert.equal(preview[0].day,1);
 assert.equal(preview[1].day,2);
});
test('foreign workspace identity fails before any campaign is displayed',()=>{
 assert.throws(()=>parseContentWorkspaceDetail(fixture(),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),ContentWorkspaceDetailInvalid);
});
test('orphaned scene fails closed rather than returning partial campaign',()=>{
 const payload=fixture();payload.data.scenes[0].content_item_id='99999999-9999-4999-8999-999999999999';
 assert.throws(()=>parseContentWorkspaceDetail(payload,workspaceId),ContentWorkspaceDetailInvalid);
});
test('publish preview refuses to invent missing captions',()=>{
 const payload=fixture();payload.data.campaigns[0].publish_plan.push({day:3,platform:'instagram',content_type:'static',objective:'Reach'});
 const detail=parseContentWorkspaceDetail(payload,workspaceId);
 const preview=buildContentPublishPreview(detail.campaigns[0]);
 assert.equal(preview[2].caption,null);
 assert.equal(preview[2].captionAvailable,false);
});
