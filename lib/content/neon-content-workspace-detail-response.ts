/** Validate the complete restricted workspace read before it reaches the UI.
 * A malformed HTTP 200 is NOT an empty campaign or successful read.
 * The server remains the authority for tenant authorization and RLS.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const obj=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const validId=(v:unknown):v is string=>typeof v==='string'&&UUID.test(v);
export class ContentWorkspaceDetailInvalid extends Error{
 constructor(){super('Respons workspace tidak lengkap. Cuba muat semula.');this.name='ContentWorkspaceDetailInvalid';}
}
const invalid=():never=>{throw new ContentWorkspaceDetailInvalid();};
export type WorkspaceDetailCampaign=Record<string,unknown>&{id:string;product_service?:string;audience?:string;status?:string;description?:string;created_at?:string;strategy?:unknown;angles?:unknown;captions?:unknown;publish_plan?:unknown};
export type WorkspaceDetailItem=Record<string,unknown>&{id:string;campaign_id:string;type?:string;title?:string;body?:unknown};
export type WorkspaceDetailScene=Record<string,unknown>&{id:string;content_item_id:string;scene_number?:number;narration?:string;dialogue?:string;visual_prompt?:string;motion_prompt?:string;duration_seconds?:number|string};
export type WorkspaceDetail=Readonly<{
 workspace:Record<string,unknown>&{id:string;name:string};
 campaigns:WorkspaceDetailCampaign[];
 contentItems:WorkspaceDetailItem[];
 scenes:WorkspaceDetailScene[];
 nextCursor?:string|null;
}>;
function uniqueIds(rows:unknown[],parentField?:string,parentIds?:Set<string>){
 const ids=new Set<string>();
 for(const row of rows){
  if(!obj(row))return invalid();
  if(!validId(row.id)||ids.has(row.id))return invalid();
  ids.add(row.id);
  if(parentField&&(!validId(row[parentField])||!parentIds?.has(row[parentField] as string)))return invalid();
 }
 return ids;
}
export function parseContentWorkspaceDetail(payload:unknown,expectedWorkspaceId:string):WorkspaceDetail{
 if(!validId(expectedWorkspaceId))invalid();
 if(!obj(payload))return invalid();
 if(!obj(payload.data))return invalid();
 const d=payload.data;
 if(!obj(d.workspace)||d.workspace.id!==expectedWorkspaceId||
    typeof d.workspace.name!=='string'||!d.workspace.name.trim()||
    d.workspace.name.length>200||
    !Array.isArray(d.campaigns)||!Array.isArray(d.contentItems)||!Array.isArray(d.scenes)||
    d.campaigns.length>100||d.contentItems.length>50000||d.scenes.length>500000)invalid();
 // Array.isArray checks above guarantee these are arrays at runtime.
 // Explicit casts retain that invariant across the fail-closed invalid() guard
 // without weakening the relationship and duplicate-ID validation.
 const campaignIds=uniqueIds(d.campaigns as unknown[]);
 const itemIds=uniqueIds(d.contentItems as unknown[],'campaign_id',campaignIds);
 uniqueIds(d.scenes as unknown[],'content_item_id',itemIds);
 const campaigns=d.campaigns as WorkspaceDetailCampaign[];
 if(d.nextCursor!==undefined&&d.nextCursor!==null&&
    (!validId(d.nextCursor)||campaigns.length!==100||campaigns.at(-1)?.id!==d.nextCursor))invalid();
 return {
  workspace:d.workspace as WorkspaceDetail['workspace'],
  campaigns,
  contentItems:d.contentItems as WorkspaceDetailItem[],
  scenes:d.scenes as WorkspaceDetailScene[],
  ...(typeof d.nextCursor==='string'?{nextCursor:d.nextCursor}:{})
 };
}
