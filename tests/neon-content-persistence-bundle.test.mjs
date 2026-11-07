import test from 'node:test';
import assert from 'node:assert/strict';
import {compileContentPersistenceBundle} from '../lib/content/neon-content-persistence-bundle.ts';
import {ContentGenerationRejected} from '../lib/content/neon-content-generation-contract.ts';

const input={
 product_service:'BROS CONTENT',audience:'Malaysian SME owners',
 description:'Content production workflow',problem:'Inconsistent content',
 objective:'Create practical campaign',duration_days:7,platforms:['facebook','instagram','tiktok']
};
const plan={
 strategy:{positioning:'Practical systems',core_message:'Consistency',
  offer_angle:'Use a campaign plan',platform_strategy:['Teach buyers']},
 angles:[{title:'Consistency',hook:'What stalls?',reason:'No operating loop'}],
 scripts:Array.from({length:3},(_,i)=>({title:'Script '+(i+1),hook:'Real selling moment',
  body:'Show the system',cta:'Read the guide'})),
 scenes:Array.from({length:7},(_,i)=>({scene_number:i+1,duration_seconds:5,
  visual_prompt:'Scene '+(i+1),motion_prompt:'Slow pan',
  narration:'System thinking',dialogue:''})),
 visuals:Array.from({length:5},(_,i)=>({title:'Visual '+(i+1),prompt:'Realistic poster '+(i+1)})),
 captions:[{platform:'facebook',caption:'Facebook copy'},
  {platform:'instagram',caption:'IG copy'},{platform:'tiktok',caption:'TikTok copy'}],
 publish_plan:[{day:1,platform:'facebook',content_type:'educational',objective:'Awareness'},
  {day:2,platform:'instagram',content_type:'carousel',objective:'Education'}]
};
const goodQc={pass:true,score:81,issues:[],fixes:[]};
test('compiles original BROS CONTENT 3 scripts, 5 visuals, one scene collection and 7 scenes',()=>{
 const bundle=compileContentPersistenceBundle(input,plan,goodQc);
 assert.equal(bundle.format,'content_neon_v1');
 assert.equal(bundle.verifiedQc,true);
 assert.equal(bundle.canWrite,false);
 assert.deepEqual(bundle.expectedCounts,{scripts:3,visuals:5,sceneCollections:1,scenes:7});
 assert.equal(bundle.items.length,9);
 assert.equal(bundle.scenes.length,7);
 assert.equal(bundle.items[0].ref,'script:0');
 assert.equal(bundle.items[3].ref,'visual_prompt:0');
 assert.equal(bundle.items[8].ref,'video_scenes:0');
 assert.deepEqual(bundle.items[8].body,{count:7});
 assert.deepEqual(bundle.scenes.map(s=>s.scene_number),[1,2,3,4,5,6,7]);
 assert.ok(bundle.scenes.every(s=>s.content_item_ref==='video_scenes:0'));
 assert.deepEqual(bundle.campaign.captions,{facebook:'Facebook copy',instagram:'IG copy',tiktok:'TikTok copy'});
 assert.equal(bundle.campaign.status,'draft');
 assert.equal(bundle.campaign.strategy.core_message,'Consistency');
 assert.equal(bundle.campaign.angles[0].reason,'No operating loop');
 assert.deepEqual(bundle.campaign.publish_plan,plan.publish_plan);
 assert.match(bundle.fingerprint,/^[0-9a-f]{64}$/);
 assert.equal(bundle.requires,'dedicated_generated_writer_and_transactional_idempotency');
});
test('compiler is deterministic and does not mutate original input, plan or QC',()=>{
 const before=JSON.stringify({input,plan,goodQc});
 const a=compileContentPersistenceBundle(input,plan,goodQc);
 const b=compileContentPersistenceBundle(input,plan,goodQc);
 assert.equal(a.fingerprint,b.fingerprint);
 assert.equal(JSON.stringify({input,plan,goodQc}),before);
 assert.notEqual(a.campaign.strategy,undefined);
});
test('rejects quality gate failures and blocks storage materialization',()=>{
 for(const qc of [
  {...goodQc,score:59},
  {...goodQc,score:88,issues:[{severity:'high',category:'unsupported_claim',field:'caption',reason:'No evidence'}]},
  {...goodQc,score:80,issues:[{severity:'high',category:'wrong_product',field:'script',reason:'Wrong product'}]}
 ])assert.throws(()=>compileContentPersistenceBundle(input,plan,qc),ContentGenerationRejected);
});
test('prevents data loss from duplicate captions or off-platform/schedule entries',()=>{
 for(const output of [
  {...plan,captions:[...plan.captions,{platform:'FACEBOOK',caption:'Overwrites original!'}]},
  {...plan,captions:[...plan.captions,{platform:'youtube',caption:'Unexpected'}]},
  {...plan,captions:[{platform:'facebook',caption:'   '}]},
  {...plan,publish_plan:[{day:1,platform:'youtube',content_type:'ad',objective:'Launch'}]},
  {...plan,publish_plan:[{day:30,platform:'facebook',content_type:'ad',objective:'Out of range'}]},
 ])assert.throws(()=>compileContentPersistenceBundle(input,output,goodQc),ContentGenerationRejected);
});
test('empty scripts and unsupported empty visual campaign refuse persistence',()=>{
 assert.throws(()=>compileContentPersistenceBundle(input,{...plan,scripts:[]},goodQc),ContentGenerationRejected);
 assert.throws(()=>compileContentPersistenceBundle(input,{...plan,scenes:[],visuals:[]},goodQc),ContentGenerationRejected);
 const withoutScenes=compileContentPersistenceBundle(input,{...plan,scenes:[]},goodQc);
 assert.equal(withoutScenes.expectedCounts.sceneCollections,0);
 assert.equal(withoutScenes.items.length,8);
 assert.equal(withoutScenes.scenes.length,0);
});
test('untrusted identity, tenant, or generation status cannot be injected into campaign columns',()=>{
 assert.throws(()=>compileContentPersistenceBundle({...input,owner_principal_id:'forged'},plan,goodQc),ContentGenerationRejected);
 assert.throws(()=>compileContentPersistenceBundle(input,{...plan,owner_principal_id:'forged'},goodQc),ContentGenerationRejected);
 assert.equal(Object.hasOwn(compileContentPersistenceBundle(input,plan,goodQc).campaign,'tenant_id'),false);
 assert.equal(Object.hasOwn(compileContentPersistenceBundle(input,plan,goodQc).campaign,'credits'),false);
 assert.equal(Object.hasOwn(compileContentPersistenceBundle(input,plan,goodQc).campaign,'generation_jobs'),false);
});
