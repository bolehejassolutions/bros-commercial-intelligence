/**
 * BROS CONTENT DEV — seven-layer output -> existing Neon column layout.
 *
 * This is a PURE COMPILER. It does not connect to Neon, execute SQL, grant roles,
 * reserve credits, create jobs or publish anything. The current restricted
 * draft writer is deliberately not authorized to insert content_items/scenes.
 * A separate, reviewed transactional writer must enforce verified membership,
 * atomicity and database idempotency before applying these rows.
 */
import {createHash} from 'node:crypto';
import {
 validateCampaignInput,validateCampaignPlan,validateQualityReview,
 evaluateQualityGate,ContentGenerationRejected,MAX_CONTENT_SCENES_PER_ITEM,
 type CampaignInput,type CampaignPlan,type QualityReview
} from './neon-content-generation-contract.ts';

type CampaignColumns=Readonly<{
 product_service:string;description:string;audience:string;problem:string;objective:string;
 duration_days:number;platforms:string[];status:'draft';strategy:CampaignPlan['strategy'];
 angles:CampaignPlan['angles'];captions:Record<string,string>;publish_plan:CampaignPlan['publish_plan'];
}>;
type ItemType='script'|'visual_prompt'|'video_scenes';
type ContentItem=Readonly<{
 ref:string;type:ItemType;title:string;body:Readonly<Record<string,unknown>>;
 sort_order:number;version:1;
}>;
type Scene=Readonly<{
 content_item_ref:'video_scenes:0';scene_number:number;duration_seconds:number;
 narration:string;dialogue:string;visual_prompt:string;motion_prompt:string;
 continuity_lock:Readonly<Record<string,never>>;
}>;
export type ContentPersistenceBundle=Readonly<{
 format:'content_neon_v1';
 fingerprint:string;
 verifiedQc:boolean;
 canWrite:false;
 requires:'dedicated_generated_writer_and_transactional_idempotency';
 campaign:CampaignColumns;
 items:ContentItem[];
 scenes:Scene[];
 expectedCounts:Readonly<{scripts:number;visuals:number;sceneCollections:number;scenes:number}>;
}>;
const reject=(reason:string):never=>{throw new ContentGenerationRejected(reason)};
const cleanString=(v:unknown)=>typeof v==='string'&&v.trim().length>0;
const sha=(value:unknown):string=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function compileContentPersistenceBundle(
 rawInput:CampaignInput,rawPlan:CampaignPlan,rawQc:QualityReview
):ContentPersistenceBundle{
 const input=validateCampaignInput(rawInput);
 const plan=validateCampaignPlan(rawPlan);
 const review=validateQualityReview(rawQc);
 const decision=evaluateQualityGate(review);
 if(!decision.accepted)reject('Campaign quality gate rejected the output');
 if(plan.scripts.length===0)reject('Cannot persist a campaign with zero scripts');
 if(plan.visuals.length===0&&plan.scenes.length===0)
  reject('Cannot persist a campaign without any visual assets or scenes');
 // One caption per platform is required for deterministic existing JSONB map.
 // Duplicate platform entries are ambiguous and must never overwrite silently.
 const captions:Record<string,string>=Object.create(null) as Record<string,string>;
 for(const c of plan.captions){
  const name=c.platform.toLowerCase();
  if(Object.prototype.hasOwnProperty.call(captions,name))
   reject('Duplicate caption platform');
  if(!cleanString(c.caption))reject('Empty caption');
  captions[name]=c.caption;
 }
 // Avoid silently including content for platforms not in this campaign.
 for(const platform of Object.keys(captions))
  if(!input.platforms.includes(platform))reject('Unexpected caption platform');
 for(const entry of plan.publish_plan)
  if(!input.platforms.includes(entry.platform.toLowerCase())||
     entry.day>input.duration_days)
   reject('Publish plan is outside campaign scope');
 const campaign:CampaignColumns={
  product_service:input.product_service,description:input.description,
  audience:input.audience,problem:input.problem,objective:input.objective,
  duration_days:input.duration_days,platforms:[...input.platforms],status:'draft',
  strategy:plan.strategy,angles:plan.angles,captions:{...captions},
  publish_plan:plan.publish_plan.map(x=>({...x,platform:x.platform.toLowerCase()}))
 };
 const items:ContentItem[]=[
  ...plan.scripts.map((script,i)=>({
   ref:'script:'+i,type:'script' as const,title:script.title,
   body:{...script},sort_order:i,version:1 as const
  })),
  ...plan.visuals.map((visual,i)=>({
   ref:'visual_prompt:'+i,type:'visual_prompt' as const,title:visual.title,
   body:{...visual},sort_order:i,version:1 as const
  })),
  ...(plan.scenes.length?[{
   ref:'video_scenes:0',type:'video_scenes' as const,title:'Video scenes',
   body:{count:plan.scenes.length},sort_order:0,version:1 as const
  }]:[])
 ];
 const scenes:Scene[]=plan.scenes.map(s=>({
  content_item_ref:'video_scenes:0' as const,scene_number:s.scene_number,
  duration_seconds:s.duration_seconds,
  narration:s.narration,dialogue:s.dialogue,
  visual_prompt:s.visual_prompt,motion_prompt:s.motion_prompt,
  continuity_lock:{} as Readonly<Record<string,never>>
 }));
 if(items.length>500||scenes.length>MAX_CONTENT_SCENES_PER_ITEM)reject('Campaign exceeds persistence limits');
 const expectedCounts={
  scripts:plan.scripts.length,visuals:plan.visuals.length,
  sceneCollections:plan.scenes.length?1:0,scenes:plan.scenes.length
 };
 const snapshot={campaign,items,scenes,expectedCounts};
 const fingerprint=sha(snapshot);
 return Object.freeze({
  format:'content_neon_v1' as const,fingerprint,verifiedQc:true,
  canWrite:false as const,
  requires:'dedicated_generated_writer_and_transactional_idempotency' as const,
  campaign,items,scenes,expectedCounts
 });
}
