/** Display-only publish preview; never schedules, posts or synthesizes captions. */
import {buildContentCampaignView} from './neon-content-campaign-view.ts';
const allowed=new Set(['facebook','instagram','tiktok','youtube','linkedin','whatsapp','threads','x']);
export type ContentPublishPreview=Readonly<{day:number;platform:string;contentType:string;objective:string;caption:string|null;captionAvailable:boolean}>;
export function buildContentPublishPreview(campaign:unknown):ReadonlyArray<ContentPublishPreview>{
 const view=buildContentCampaignView(campaign);
 const captions=new Map(view.captions.map(row=>[row.platform,row.caption]));
 return Object.freeze(view.publishPlan.map(row=>{
  const platform=row.platform.trim().toLowerCase();
  // Multi-platform historical labels are not safe to infer or auto-match.
  const caption=allowed.has(platform)?captions.get(platform)??null:null;
  return Object.freeze({day:row.day,platform:row.platform,contentType:row.contentType,
   objective:row.objective,caption,captionAvailable:caption!==null});
 }));
}
