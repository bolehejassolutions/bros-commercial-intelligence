import test from 'node:test';
import assert from 'node:assert/strict';
import {
 validateCampaignInput,validateCampaignPlan,validateQualityReview,evaluateQualityGate,
 buildCampaignPlanPrompt,buildQualityPrompt,ContentGenerationRejected,
} from '../lib/content/neon-content-generation-contract.ts';
import {createContentCampaignPlanner} from '../lib/content/neon-content-generation-orchestrator.ts';

const input={
 product_service:'BROS CONTENT',audience:'Malaysian small business owners',
 description:'Marketing content system',problem:'No consistent content',
 objective:'Draft a useful campaign',duration_days:7,platforms:['facebook','tiktok']
};
const dna={brand_name:'BROS',voice:{language:'Malay'},doctrine:'Facts only'};
const plan={
 strategy:{positioning:'Practical content system',core_message:'Consistent planning',
  offer_angle:'Plan campaigns',platform_strategy:['Short-form educational videos']},
 angles:[{title:'A',hook:'Why content stalls?',reason:'No repeatable process'}],
 scripts:[{title:'Practical hook',hook:'Why?',body:'Create a plan',cta:'Request the checklist'}],
 scenes:[{scene_number:1,duration_seconds:8,visual_prompt:'Planning board',
  motion_prompt:'Slow pan',narration:'Step one',dialogue:''}],
 visuals:[{title:'Board',prompt:'Realistic planning board'}],
 captions:[{platform:'facebook',caption:'Organize your content'}],
 publish_plan:[{day:1,platform:'facebook',content_type:'educational',objective:'Awareness'}]
};
const review={pass:true,score:82,issues:[],fixes:[]};
test('seven original campaign layers validate, preserving content and schema identity',()=>{
 assert.deepEqual(Object.keys(validateCampaignPlan(plan)),[
  'strategy','angles','scripts','scenes','visuals','captions','publish_plan']);
 assert.equal(validateCampaignInput(input).platforms[1],'tiktok');
 assert.equal(evaluateQualityGate(review).accepted,true);
 assert.match(buildCampaignPlanPrompt(input,dna),/seven coherent layers/);
 assert.match(buildQualityPrompt(input,dna,plan),/HIGH only/);
});
test('wrong product/unsupported high-severity claims block but medium polish does not',()=>{
 for(const category of ['wrong_product','unsupported_claim','factual_error','unsafe_content','structural_failure']){
  const result=evaluateQualityGate({...review,score:88,issues:[{severity:'high',category,field:'caption',reason:'Wrong'}]});
  assert.equal(result.accepted,false,category);
 }
 assert.equal(evaluateQualityGate({...review,pass:false,score:80,
  issues:[{severity:'medium',category:'cta',field:'script',reason:'Polish'}]}).accepted,true);
 assert.equal(evaluateQualityGate({...review,score:59}).accepted,false);
});
test('rejects extra layers, malformed scenes, unrecognized platforms and oversize content',()=>{
 for(const data of [
  {...plan,secret_data:'unexpected'}, {...plan,angles:null},
  {...plan,scenes:[{...plan.scenes[0],scene_number:2}]},
  {...plan,scenes:[{...plan.scenes[0],duration_seconds:-1}]},
  {...plan,captions:[{platform:'unknown',caption:'Copy'}]},
  {...plan,publish_plan:[{...plan.publish_plan[0],day:91}]},
  {...plan,visuals:[{title:'Asset',prompt:'x'.repeat(10001)}]}
 ])assert.throws(()=>validateCampaignPlan(data),ContentGenerationRejected);
});
test('rejects malformed review and external identity injection before generating',()=>{
 for(const data of [
  {...review,score:Infinity}, {...review,score:-1},
  {...review,issues:[{severity:'high',category:'invented',field:'f',reason:'r'}]},
  {...review,extra:true},
 ])assert.throws(()=>validateQualityReview(data),ContentGenerationRejected);
 for(const data of [
  {...input,owner_principal_id:'fake'}, {...input,duration_days:100},
  {...input,platforms:['facebook','FACEBOOK']},
  {...input,product_service:''},
 ])assert.throws(()=>validateCampaignInput(data),ContentGenerationRejected);
});
test('two-pass generation uses seven-layer schema, QC, no persistence or credits',async()=>{
 const calls=[];
 const generator=async(prompt,schema,name)=>{
  calls.push({prompt,schema,name});
  return name==='bros_campaign'?plan:review;
 };
 const r=await createContentCampaignPlanner(generator)(input,dna);
 assert.equal(r.operation,'preview_only');
 assert.equal(r.readyForPersistence,false);
 assert.equal(r.gate.accepted,true);
 assert.deepEqual(calls.map(x=>x.name),['bros_campaign','bros_qc']);
 assert.deepEqual(calls[0].schema.required,Object.keys(plan));
 assert.deepEqual(calls[1].schema.required,['pass','score','issues','fixes']);
 assert.ok(calls[0].prompt.includes('"brand_name":"BROS"'));
});
test('fail before paid call for invalid input or DNA; fail closed for broken first/second AI response',async()=>{
 let calls=0;
 const first=createContentCampaignPlanner(async()=>{calls++;return plan;});
 await assert.rejects(first({...input,platforms:[]},dna),ContentGenerationRejected);
 await assert.rejects(first(input,null),ContentGenerationRejected);
 assert.equal(calls,0);
 const broken=createContentCampaignPlanner(async(_prompt,_schema,name)=>{
  calls++;return name==='bros_campaign'?{...plan,scenes:null}:review;
 });
 await assert.rejects(broken(input,dna),ContentGenerationRejected);
 assert.equal(calls,1);
 const second=createContentCampaignPlanner(async(_prompt,_schema,name)=>{
  return name==='bros_campaign'?plan:{...review,score:NaN};
 });
 await assert.rejects(second(input,dna),ContentGenerationRejected);
});


test('tenant creative configuration reaches both planning and editorial QC',async()=>{
 const calls=[];
 const planner=createContentCampaignPlanner(async(prompt,_schema,name)=>{
  calls.push(prompt);
  return name==='bros_campaign'?plan:review;
 });
 const context={content_creative:{brand_id:'bros-sell',preset_ids:['SELL_MANGA_STORY','REAL_PRODUCT_SHOWCASE'],
  communication_standard:'bros-sell-plain-language-v1'}};
 const visual={presetId:'SELL_MANGA_STORY',aspectRatio:'4:5'};
 await assert.rejects(planner(input,dna,visual),ContentGenerationRejected);
 await assert.rejects(planner(input,context,{presetId:'REAL_PRODUCT_SHOWCASE',aspectRatio:'16:9'}),ContentGenerationRejected);
 assert.equal(calls.length,0);
 await planner(input,context,visual);
 assert.match(calls[0],/KENA.*NAMPAK NILAI/);
 assert.match(calls[0],/SELL_MANGA_STORY at 4:5/);
 assert.match(calls[1],/kedai kopi/);
 assert.match(calls[1],/SELL_MANGA_STORY and 4:5/);
 await planner(input,{content_creative:{...context.content_creative,brand_id:'other-brand'}},visual);
 assert.doesNotMatch(calls[2],/NAMPAK NILAI|BROS SELL/);
 assert.doesNotMatch(calls[3],/kedai kopi|BROS SELL/);
});
