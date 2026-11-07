/**
 * Server-only and opt-in adapter for the Responses structured-output API.
 * This module NEVER runs on import or in Preview by default. No secrets are logged.
 * Paid model calls require an explicitly enabled runner, separate from the UI flag.
 */
import {ContentGenerationRejected} from './neon-content-generation-contract.ts';
type JsonSchema=Readonly<Record<string,unknown>>;
type Fetcher=typeof fetch;
const string={type:'string'};
const integer={type:'integer'};
const number={type:'number'};
function record(properties:Record<string,unknown>):JsonSchema{
 return {type:'object',additionalProperties:false,required:Object.keys(properties),properties};
}
function array(items:JsonSchema|typeof string):JsonSchema{return {type:'array',items};}
export const campaignPlanSchema=record({
 strategy:record({positioning:string,core_message:string,offer_angle:string,platform_strategy:array(string)}),
 angles:array(record({title:string,hook:string,reason:string})),
 scripts:array(record({title:string,hook:string,body:string,cta:string})),
 scenes:array(record({scene_number:integer,duration_seconds:number,visual_prompt:string,motion_prompt:string,narration:string,dialogue:string})),
 visuals:array(record({title:string,prompt:string})),
 captions:array(record({platform:string,caption:string})),
 publish_plan:array(record({day:integer,platform:string,content_type:string,objective:string})),
});
export const qualityReviewSchema=record({
 pass:{type:'boolean'},score:number,
 issues:array(record({severity:{type:'string',enum:['low','medium','high']},
  category:{type:'string',enum:[
   'wrong_product','unsupported_claim','factual_error','unsafe_content','structural_failure',
   'audience_fit','cta','platform_fit','continuity','repetition','polish'
  ]},field:string,reason:string})),
 fixes:array(record({field:string,replacement:string}))
});
export function extractResponsesJson(raw:unknown):unknown{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))
  throw new ContentGenerationRejected('Invalid model response');
 const response=raw as Record<string,unknown>;
 if(response.status!=='completed')
  throw new ContentGenerationRejected('Model did not complete');
 let value=typeof response.output_text==='string'?response.output_text:'';
 if(!value.trim()&&Array.isArray(response.output)){
  const segments:string[]=[];
  for(const entry of response.output){
   if(!entry||typeof entry!=='object'||(entry as Record<string,unknown>).type!=='message')continue;
   const parts=(entry as Record<string,unknown>).content;
   if(!Array.isArray(parts))continue;
   for(const part of parts){
    if(part&&typeof part==='object'&&(part as Record<string,unknown>).type==='output_text'&&
       typeof (part as Record<string,unknown>).text==='string')
      segments.push((part as Record<string,string>).text);
   }
  }
  value=segments.join('');
 }
 if(!value.trim()||value.length>150000)throw new ContentGenerationRejected('Missing or oversized structured output');
 try{return JSON.parse(value);}catch{throw new ContentGenerationRejected('Invalid structured JSON output');}
}
export type StructuredProviderConfig=Readonly<{
 apiKey?:string;model?:string;enabled:boolean;maxOutputTokens?:number;
}>;
export function createContentResponsesGenerator(config:StructuredProviderConfig,fetcher:Fetcher=fetch){
 if(!config?.enabled)throw new Error('CONTENT model generation disabled');
 if(typeof config.apiKey!=='string'||config.apiKey.length<20)
  throw new Error('CONTENT model credential missing');
 if(typeof config.model!=='string'||!/^[a-zA-Z0-9._-]{3,80}$/.test(config.model))
  throw new Error('Explicit approved CONTENT model required');
 const maxTokens=config.maxOutputTokens??12000;
 if(!Number.isInteger(maxTokens)||maxTokens<512||maxTokens>20000)
  throw new Error('Invalid CONTENT model token cap');
 if(typeof fetcher!=='function')throw new Error('Missing model transport');
 return async function generate(prompt:string,schema:JsonSchema,name:string):Promise<unknown>{
  if(typeof prompt!=='string'||prompt.length<30||prompt.length>80000||
     typeof name!=='string'||!/^[a-z][a-z0-9_]{2,40}$/.test(name)||
     !schema||typeof schema!=='object')throw new ContentGenerationRejected('Invalid model request');
  let response:Response;
  try{response=await fetcher('https://api.openai.com/v1/responses',{
   method:'POST',headers:{authorization:'Bearer '+config.apiKey,'content-type':'application/json'},
   body:JSON.stringify({
    model:config.model,
    input:prompt,
    store:false,
    max_output_tokens:maxTokens,
    text:{format:{type:'json_schema',name,strict:true,schema}},
   }),
   cache:'no-store',redirect:'error',signal:AbortSignal.timeout(45000)
  });}catch{throw new ContentGenerationRejected('Model request unavailable');}
  if(!response.ok)throw new ContentGenerationRejected('Model returned an unsuccessful status');
  let body:unknown;
  try{body=await response.json();}catch{throw new ContentGenerationRejected('Invalid model response JSON');}
  return extractResponsesJson(body);
 };
}
