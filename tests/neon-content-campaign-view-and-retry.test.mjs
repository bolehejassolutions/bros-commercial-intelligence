import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareContentDraftRetry,isContentDraftSaveFeedbackCurrent} from '../lib/content/neon-content-draft-retry.ts';
import {buildContentCampaignView} from '../lib/content/neon-content-campaign-view.ts';

const workspaceA='22222222-2222-4222-8222-222222222222';
const workspaceB='77777777-7777-4777-8777-777777777777';
const draft={product_service:'BROS SELL',audience:'Malaysian sellers',
 description:'Practical selling',problem:'No process',objective:'Education',
 duration_days:7,platforms:['facebook','instagram','tiktok']};
let call=0;
const key=()=>{call++;return 'attempt-'+String(call).padStart(8,'0')};
test('network error and retry of same draft reuse one idempotency key',()=>{
 call=0;
 const first=prepareContentDraftRetry(null,workspaceA,draft,key);
 const second=prepareContentDraftRetry(first,workspaceA,{...draft},key);
 assert.equal(first.key,second.key);
 assert.equal(call,1);
});
test('edited content, changed workspace and successful-save reset create distinct keys',()=>{
 call=0;
 const first=prepareContentDraftRetry(null,workspaceA,draft,key);
 const edited=prepareContentDraftRetry(first,workspaceA,{...draft,audience:'New audience'},key);
 const moved=prepareContentDraftRetry(edited,workspaceB,{...draft,audience:'New audience'},key);
 const fresh=prepareContentDraftRetry(null,workspaceB,{...draft,audience:'New audience'},key);
 assert.notEqual(first.key,edited.key);
 assert.notEqual(edited.key,moved.key);
 assert.notEqual(moved.key,fresh.key);
 assert.equal(call,4);
});
test('fail closed on invalid key factory, workspace and malformed payload',()=>{
 assert.throws(()=>prepareContentDraftRetry(null,'not-a-workspace',draft,key));
 assert.throws(()=>prepareContentDraftRetry(null,workspaceA,null,key));
 assert.throws(()=>prepareContentDraftRetry(null,workspaceA,draft,()=>''),/key/);
 assert.throws(()=>prepareContentDraftRetry(null,workspaceA,{huge:'x'.repeat(20000)},key),/payload/);
});
const legacy={
 strategy:{positioning:'Selling education',core_message:'Explain, do not persuade',
 offer_angle:'System instead of tricks',platform_strategy:['Malaysia-first','TikTok']},
 angles:[{title:'Real moment',hook:'Buyer goes quiet',reason:'Lacks clarity'}],
 captions:{facebook:'Post Facebook',instagram:'Post Instagram',tiktok:'Post TikTok'},
 publish_plan:[{day:1,platform:'TikTok, Instagram, Facebook',
 content_type:'educational',objective:'Explain'}]
};
test('legacy restored campaigns show all strategy, angle, caption and combined-platform data without scheduling',()=>{
 const v=buildContentCampaignView(legacy);
 assert.equal(v.hasGeneratedContent,true);
 assert.equal(v.strategy.length,3);
 assert.deepEqual(v.platformStrategy,['Malaysia-first','TikTok']);
 assert.equal(v.angles[0].hook,'Buyer goes quiet');
 assert.deepEqual(v.captions,[
  {platform:'facebook',caption:'Post Facebook'},
  {platform:'instagram',caption:'Post Instagram'},
  {platform:'tiktok',caption:'Post TikTok'}
 ]);
 assert.equal(v.publishPlan[0].platform,'TikTok, Instagram, Facebook');
 assert.equal(v.publishPlan[0].day,1);
});
test('new caption array and blank draft render consistently',()=>{
 const arrView=buildContentCampaignView({...legacy,captions:[
  {platform:'facebook',caption:'Modern post'},
  {platform:'tiktok',caption:'Modern clip'}
 ]});
 assert.equal(arrView.captions.length,2);
 assert.equal(arrView.captions[1].caption,'Modern clip');
 const draftView=buildContentCampaignView({status:'draft',strategy:null,angles:null,captions:null});
 assert.equal(draftView.hasGeneratedContent,false);
 assert.deepEqual(draftView.captions,[]);
});
test('untrusted content cannot inject unknown platforms, duplicate captions, or oversized output',()=>{
 const v=buildContentCampaignView({
  captions:{facebook:'Good',FACEBOOK:'Duplicate',hacked:'not a platform'},
  publish_plan:[{day:1,platform:'facebook',content_type:'post',objective:'Teach'},
    {day:91,platform:'tiktok',content_type:'video',objective:'Wrong day'}],
  angles:[null,{title:'Valid',hook:'Short',reason:'Context'}]
 });
 // Both normalized Facebook entries are ambiguous; never select the first.
 assert.deepEqual(v.captions,[]);
 assert.equal(v.publishPlan.length,1);
 assert.equal(v.angles.length,1);
});

test('late draft save acknowledgement cannot update another selected workspace',()=>{
 assert.equal(isContentDraftSaveFeedbackCurrent(workspaceA,workspaceA),true);
 assert.equal(isContentDraftSaveFeedbackCurrent(workspaceA,workspaceB),false);
 assert.equal(isContentDraftSaveFeedbackCurrent(workspaceB,workspaceA),false);
 assert.equal(isContentDraftSaveFeedbackCurrent('invalid',workspaceA),false);
});
