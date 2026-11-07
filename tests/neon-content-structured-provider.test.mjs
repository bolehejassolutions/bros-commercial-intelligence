import test from 'node:test';
import assert from 'node:assert/strict';
import {
 campaignPlanSchema,qualityReviewSchema,extractResponsesJson,createContentResponsesGenerator,
} from '../lib/content/neon-content-structured-provider.ts';
import {ContentGenerationRejected} from '../lib/content/neon-content-generation-contract.ts';
const secret='sk-test-not-a-real-key-1234567890123456789';
const config={enabled:true,apiKey:secret,model:'example-model',maxOutputTokens:900};
test('Responses JSON schemas are strict with all seven original layers and QC fields',()=>{
 assert.equal(campaignPlanSchema.additionalProperties,false);
 assert.deepEqual(campaignPlanSchema.required,
  ['strategy','angles','scripts','scenes','visuals','captions','publish_plan']);
 for(const layer of ['strategy','angles','scripts','scenes','visuals','captions','publish_plan'])
  assert.ok(Object.hasOwn(campaignPlanSchema.properties,layer));
 assert.deepEqual(qualityReviewSchema.required,['pass','score','issues','fixes']);
 assert.deepEqual(qualityReviewSchema.properties.issues.items.properties.severity.enum,
  ['low','medium','high']);
});
test('extracts both Responses transport forms and rejects failed or incomplete API results',()=>{
 assert.deepEqual(extractResponsesJson({status:'completed',output_text:'{"ok":true}'}),{ok:true});
 assert.deepEqual(extractResponsesJson({status:'completed',output:[{
  type:'message',content:[{type:'output_text',text:'{"status":"ok"}'}]
 }]}),{status:'ok'});
 for(const raw of [
  null,{}, {status:'failed',output_text:'{"ok":true}'},
  {status:'completed',output:[]},
  {status:'completed',output_text:'not-json'},
  {status:'completed',output_text:'x'.repeat(150001)},
 ])assert.throws(()=>extractResponsesJson(raw),ContentGenerationRejected);
});
test('disabled or missing credential/model blocks before network access',async()=>{
 let calls=0;const transport=async()=>{calls++;throw Error('never network');};
 for(const cfg of [
  {...config,enabled:false},{...config,apiKey:''},
  {...config,model:''},{...config,maxOutputTokens:999999}
 ])assert.throws(()=>createContentResponsesGenerator(cfg,transport));
 assert.equal(calls,0);
});
test('valid model request is opt-in, structured, bounded, non-stored and never returns secrets',async()=>{
 let calls=0;
 const generate=createContentResponsesGenerator(config,async(url,options)=>{
  calls++;
  assert.equal(url,'https://api.openai.com/v1/responses');
  assert.equal(options.method,'POST');
  const req=JSON.parse(options.body);
  assert.equal(req.store,false);
  assert.equal(req.max_output_tokens,900);
  assert.equal(req.model,'example-model');
  assert.equal(req.text.format.type,'json_schema');
  assert.equal(req.text.format.strict,true);
  assert.equal(req.text.format.name,'bros_campaign');
  assert.deepEqual(req.text.format.schema,campaignPlanSchema);
  return Response.json({status:'completed',output_text:'{"valid":true}'});
 });
 assert.deepEqual(await generate('Campaign request with enough data',campaignPlanSchema,'bros_campaign'),{valid:true});
 assert.equal(calls,1);
});
test('remote errors, invalid transport responses and request errors never leak provider body or key',async()=>{
 for(const transport of [
  async()=>{throw new Error('network secret '+secret);},
  async()=>Response.json({error:{message:'sensitive '+secret}},{status:500}),
  async()=>new Response('not-json',{status:200}),
  async()=>Response.json({status:'incomplete',output_text:'not-json'}),
 ]){
  const gen=createContentResponsesGenerator(config,transport);
  await assert.rejects(gen('Content campaign input for testing',qualityReviewSchema,'bros_qc'),
    error=>error instanceof ContentGenerationRejected&&!error.message.includes(secret));
 }
 let called=0;
 const gen=createContentResponsesGenerator(config,async()=>{called++;throw Error('called');});
 await assert.rejects(gen('short',campaignPlanSchema,'bros_campaign'),ContentGenerationRejected);
 assert.equal(called,0);
});
