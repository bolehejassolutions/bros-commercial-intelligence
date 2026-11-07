/**
 * Pure, fail-closed verification of stored rows before idempotent replay.
 * Counting saved items and scenes is insufficient: content may be replaced
 * without changing counts. Replays must match the approved seven-layer bundle.
 * Never modifies SQL records, credits, tenant roles or historical data.
 */
import {ContentReadDenied} from './neon-content-workspace-reader.ts';
import type {ContentPersistenceBundle} from './neon-content-persistence-bundle.ts';

type Row=Readonly<Record<string,unknown>>;
const deny=():never=>{throw new ContentReadDenied();};
const object=(v:unknown):v is Record<string,unknown>=>
 v!==null&&typeof v==='object'&&!Array.isArray(v);

function canonical(value:unknown):string {
 let nodes=0;
 function normalize(item:unknown,depth:number):unknown {
  if(++nodes>5000||depth>18)return deny();
  if(item===null||typeof item==='string'||typeof item==='boolean')return item;
  if(typeof item==='number'&&Number.isFinite(item))return item;
  if(Array.isArray(item))return item.map(x=>normalize(x,depth+1));
  if(object(item)){
   const result:Record<string,unknown>=Object.create(null);
   for(const key of Object.keys(item).sort())result[key]=normalize(item[key],depth+1);
   return result;
  }
  return deny();
 }
 const text=JSON.stringify(normalize(value,0));
 if(typeof text!=='string'||text.length>150000)return deny();
 return text;
}
const equal=(a:unknown,b:unknown)=>canonical(a)===canonical(b);
const text=(v:unknown)=>typeof v==='string'?v:deny();
const integer=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)?v:deny();
const decimal=(v:unknown)=>{
 if((typeof v!=='number'&&typeof v!=='string')||v==='')return deny();
 const n=Number(v);
 if(!Number.isFinite(n))return deny();
 return n;
};

/** Rows must come from a tenant/principal/workspace-filtered SELECT under RLS. */
export function verifyContentGeneratedReplay(
 bundle:ContentPersistenceBundle,
 campaign:Row,
 items:readonly Row[],
 scenes:readonly Row[]
):void {
 if(!bundle?.verifiedQc||bundle.canWrite!==false||
    !object(campaign)||!Array.isArray(items)||!Array.isArray(scenes)||
    items.length!==bundle.items.length||scenes.length!==bundle.scenes.length)
  return deny();
 const c=bundle.campaign;
 for(const field of [
  'product_service','description','audience','problem','objective','status'
 ] as const){
  if(text(campaign[field])!==c[field])return deny();
 }
 if(integer(campaign.duration_days)!==c.duration_days||
    !equal(campaign.platforms,c.platforms)||
    !equal(campaign.strategy,c.strategy)||
    !equal(campaign.angles,c.angles)||
    !equal(campaign.captions,c.captions)||
    !equal(campaign.publish_plan,c.publish_plan))return deny();

 const ids=new Map<string,string>();
 for(const item of items){
  const key=text(item.type)+':'+integer(item.sort_order);
  if(ids.has(key))return deny();
  const expected=bundle.items.find(x=>x.ref===key);
  if(!expected||
     text(item.title)!==expected.title||
     integer(item.version)!==expected.version||
     !equal(item.body,expected.body))return deny();
  const id=text(item.id);
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
   return deny();
  ids.set(key,id);
 }
 if(ids.size!==bundle.items.length)return deny();
 const manifest=ids.get('video_scenes:0');
 const numbers=new Set<number>();
 for(const scene of scenes){
  const number=integer(scene.scene_number);
  if(numbers.has(number))return deny();
  numbers.add(number);
  const expected=bundle.scenes.find(s=>s.scene_number===number);
  if(!expected||!manifest||text(scene.content_item_id)!==manifest||
     decimal(scene.duration_seconds)!==expected.duration_seconds||
     text(scene.narration)!==expected.narration||
     text(scene.dialogue)!==expected.dialogue||
     text(scene.visual_prompt)!==expected.visual_prompt||
     text(scene.motion_prompt)!==expected.motion_prompt||
     !equal(scene.continuity_lock,expected.continuity_lock))return deny();
 }
 if(numbers.size!==bundle.scenes.length)return deny();
}
