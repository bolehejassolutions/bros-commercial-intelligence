/** Confirm draft persistence against the independently read restricted workspace.
 * A matching ID/status alone cannot prove the submitted brief was stored intact.
 */
import {parseContentWorkspaceDetail} from './neon-content-workspace-detail-response.ts';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Draft=Readonly<{product_service:string;audience:string;description:string;problem:string;objective:string;duration_days:number;platforms:readonly string[]}>;
export class ContentDraftReadbackUnverified extends Error {
 constructor(){super('Draf diterima tetapi kandungan tersimpan belum dapat disahkan. Cuba semula dengan selamat.');this.name='ContentDraftReadbackUnverified';}
}
function sameStoredBrief(row:Record<string,unknown>,expected:Draft){
 const expectedPlatforms=expected.platforms.map(p=>p.toLowerCase());
 const stored=row.platforms;
 return row.product_service===expected.product_service.trim()&&
  row.audience===expected.audience.trim()&&
  row.description===expected.description&&row.problem===expected.problem&&
  row.objective===expected.objective&&row.duration_days===expected.duration_days&&
  Array.isArray(stored)&&stored.length===expectedPlatforms.length&&
  stored.every((p,i)=>p===expectedPlatforms[i]);
}
export function confirmContentDraftReadback(payload:unknown,workspaceId:string,campaignId:string,expected:Draft){
 if(!UUID.test(workspaceId)||!UUID.test(campaignId)||!expected||
  !Array.isArray(expected.platforms))throw new ContentDraftReadbackUnverified();
 let detail:ReturnType<typeof parseContentWorkspaceDetail>;
 try{detail=parseContentWorkspaceDetail(payload,workspaceId);}
 catch{throw new ContentDraftReadbackUnverified();}
 const matching=detail.campaigns.filter(row=>row.id===campaignId&&row.status==='draft');
 if(matching.length!==1||!sameStoredBrief(matching[0],expected))
  throw new ContentDraftReadbackUnverified();
 return detail;
}
