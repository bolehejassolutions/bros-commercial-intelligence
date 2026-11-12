/**
 * Safe presentational shaping of recovered BROS CONTENT campaign JSONB.
 * Supports the historical Supabase platform->caption map and new caption array.
 * This is for UI DISPLAY ONLY: no generation, scheduling or publishing.
 */
type R=Readonly<Record<string,unknown>>;
const record=(v:unknown):v is R=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const str=(v:unknown,max=8000)=>typeof v==='string'?v.slice(0,max):'';
const arr=(v:unknown,max=100):unknown[]=>Array.isArray(v)?v.slice(0,max):[];
const platforms=new Set(['facebook','instagram','tiktok','youtube','linkedin','whatsapp','threads','x']);

export type ContentCampaignView=Readonly<{
 strategy:ReadonlyArray<{label:string;value:string}>;
 angles:ReadonlyArray<{title:string;hook:string;reason:string}>;
 platformStrategy:string[];
 captions:ReadonlyArray<{platform:string;caption:string}>;
 publishPlan:ReadonlyArray<{day:number;platform:string;contentType:string;objective:string}>;
 hasGeneratedContent:boolean;
}>;

export function buildContentCampaignView(raw:unknown):ContentCampaignView {
 // Campaign JSONB must be plain data: never invoke nested accessors during display.
 // A malformed field is omitted rather than blocking independent valid fields.
 const safe=(value:unknown,depth=0):unknown=>{
  if(depth>12)return undefined;
  if(value===null||typeof value==='string'||typeof value==='boolean'||
    (typeof value==='number'&&Number.isFinite(value)))return value;
  if(!value||typeof value!=='object')return undefined;
  const proto=Object.getPrototypeOf(value);
  if(!Array.isArray(value)&&proto!==Object.prototype&&proto!==null)return undefined;
  const descriptors=Object.getOwnPropertyDescriptors(value);
  if(Object.values(descriptors).some(d=>!('value' in d)))return undefined;
  if(Array.isArray(value)){
   if(value.length>300)return undefined;
   return Array.from({length:value.length},(_,i)=>safe(descriptors[String(i)]?.value,depth+1));
  }
  const out:Record<string,unknown>=Object.create(null);
  for(const [key,descriptor] of Object.entries(descriptors).slice(0,350)){
   const child=safe(descriptor.value,depth+1);
   if(child!==undefined)out[key]=child;
  }
  return out;
 };
 const sanitized=safe(raw);
 const c=record(sanitized)?sanitized:{};
 const strategy=record(c.strategy)?c.strategy:{};
 const strategyItems=[
  {label:'Kedudukan jenama',value:str(strategy.positioning)},
  {label:'Mesej utama',value:str(strategy.core_message)},
  {label:'Sudut tawaran',value:str(strategy.offer_angle)}
 ].filter(row=>row.value.trim());
 const platformStrategy=arr(strategy.platform_strategy,30).map(x=>str(x)).filter(Boolean);
 const angles=arr(c.angles,100).flatMap(row=>record(row)?[{
  title:str(row.title),hook:str(row.hook),reason:str(row.reason)
 }]:[]);
 const captionRows=Array.isArray(c.captions)
  ?arr(c.captions,100).flatMap(row=>record(row)?[{
     platform:str(row.platform,80).trim().toLowerCase(),caption:str(row.caption,10000)
    }]:[])
  :record(c.captions)?Object.entries(c.captions).slice(0,8).map(([platform,caption])=>({
     platform:platform.trim().toLowerCase(),caption:str(caption,10000)
    })):[];
 // Reject every member of a normalized-platform collision before any consumer
 // (including publish preview) can mistake the first row for an approved caption.
 const counts=new Map<string,number>();
 for(const row of captionRows){
  if(platforms.has(row.platform)&&row.caption.trim())
   counts.set(row.platform,(counts.get(row.platform)??0)+1);
 }
 const captions=captionRows.filter(row=>
  platforms.has(row.platform)&&Boolean(row.caption.trim())&&counts.get(row.platform)===1
 );
 // Historic source may contain a comma-separated multi-platform label.
 // Preserve the original display label; never silently schedule these rows.
 const publishPlan=arr(c.publish_plan,300).flatMap(row=>{
  if(!record(row)||!Number.isInteger(row.day)||Number(row.day)<1||
     Number(row.day)>90)return [];
  const platform=str(row.platform,180);
  if(!platform)return [];
  return [{day:Number(row.day),platform,contentType:str(row.content_type,180),
   objective:str(row.objective,2000)}];
 });
 return Object.freeze({
  strategy:strategyItems,platformStrategy,angles,captions,publishPlan,
  hasGeneratedContent:Boolean(
   strategyItems.length||platformStrategy.length||angles.length||
   captions.length||publishPlan.length)
 });
}
