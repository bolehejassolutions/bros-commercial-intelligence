/** Confirm a draft write using an independently read restricted workspace snapshot.
 * A 201 receipt alone does not establish that the campaign is readable.
 * The caller must retain its idempotency key when this check fails.
 */
import {parseContentWorkspaceDetail} from './neon-content-workspace-detail-response.ts';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class ContentDraftReadbackUnverified extends Error {
 constructor(){super('Draf diterima tetapi belum dapat disahkan melalui bacaan semula. Cuba semula dengan selamat.');this.name='ContentDraftReadbackUnverified';}
}
export function confirmContentDraftReadback(payload:unknown,workspaceId:string,campaignId:string){
 if(!UUID.test(workspaceId)||!UUID.test(campaignId))throw new ContentDraftReadbackUnverified();
 let detail:ReturnType<typeof parseContentWorkspaceDetail>;
 try{detail=parseContentWorkspaceDetail(payload,workspaceId);}
 catch{throw new ContentDraftReadbackUnverified();}
 const matching=detail.campaigns.filter(row=>row.id===campaignId&&row.status==='draft');
 if(matching.length!==1)throw new ContentDraftReadbackUnverified();
 return detail;
}
