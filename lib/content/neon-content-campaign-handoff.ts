/** Explicit user-initiated export of a single authenticated CONTENT campaign.
 * This is a text/metadata handoff, NOT a generated-media or publishing artifact.
 * Caller must supply only rows returned by the tenant-scoped restricted reader.
 */
export type ContentHandoffCampaign={id:string;[key:string]:unknown};
export type ContentHandoffItem={id:string;campaign_id:string;[key:string]:unknown};
export type ContentHandoffScene={id:string;content_item_id:string;[key:string]:unknown};

export function buildContentCampaignHandoff(
 workspaceId:string,campaign:ContentHandoffCampaign,
 items:readonly ContentHandoffItem[],scenes:readonly ContentHandoffScene[]
):string {
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 if(!uuid.test(workspaceId)||!uuid.test(campaign.id)||campaign.workspace_id!==workspaceId)
  throw new Error('Invalid campaign handoff scope');
 const selected=items.filter(item=>item.campaign_id===campaign.id);
 if(selected.some(item=>!uuid.test(item.id)))throw new Error('Invalid campaign item identity');
 const ids=new Set(selected.map(item=>item.id));
 if(ids.size!==selected.length)throw new Error('Duplicate campaign item');
 const includedScenes=scenes.filter(scene=>ids.has(scene.content_item_id));
 if(includedScenes.some(scene=>!uuid.test(scene.id)))throw new Error('Invalid campaign scene identity');
 const sceneIds=new Set(includedScenes.map(scene=>scene.id));
 if(sceneIds.size!==includedScenes.length)throw new Error('Duplicate campaign scene');
 return JSON.stringify({
  format:'bros-content-campaign-handoff-v1',
  workspace_id:workspaceId,
  campaign,
  content_items:selected,
  scenes:includedScenes,
  media_verified:false,
  publication_verified:false,
  note:'Export teks dan metadata sahaja. Tiada fail imej/video atau kelulusan penerbitan disertakan.'
 },null,2);
}
