/** Tenant-detail presentation guard: only show scenes attached to items of the selected campaign.
 * No writes, generation, publishing, or inferred content.
 */
type Item={id:string;campaign_id:string};
type Scene={id:string;content_item_id:string;scene_number?:number};
export function scopeContentCampaignItems<I extends Item,S extends Scene>(
 campaignId:string,items:readonly I[],scenes:readonly S[]
):ReadonlyArray<Readonly<{item:I;scenes:readonly S[]}>>{
 if(!campaignId||!Array.isArray(items)||!Array.isArray(scenes))return Object.freeze([]);
 // A scene carries only content_item_id. If the same item ID is claimed by
 // another campaign, its scene ownership cannot be established safely.
 const ambiguous=new Set<string>();
 const ownership=new Map<string,string>();
 for(const item of items){
  if(!item||typeof item.id!=='string'||!item.id.length||typeof item.campaign_id!=='string')continue;
  const prior=ownership.get(item.id);
  if(prior!==undefined&&prior!==item.campaign_id)ambiguous.add(item.id);
  else ownership.set(item.id,item.campaign_id);
 }
 // Scene identifiers must not be attributed to two different content items.
 // A malformed or mixed readback must never guess which item owns the scene.
 const sceneOwner=new Map<string,string>();
 const ambiguousScenes=new Set<string>();
 for(const scene of scenes){
  if(!scene||typeof scene.id!=='string'||!scene.id.length||typeof scene.content_item_id!=='string')continue;
  const prior=sceneOwner.get(scene.id);
  if(prior!==undefined&&prior!==scene.content_item_id)ambiguousScenes.add(scene.id);
  else sceneOwner.set(scene.id,scene.content_item_id);
 }
 const owned=items.filter(i=>i&&i.campaign_id===campaignId&&typeof i.id==='string'&&i.id.length>0&&!ambiguous.has(i.id));
 const unique=new Set<string>();
 return Object.freeze(owned.filter(i=>{if(unique.has(i.id))return false;unique.add(i.id);return true;})
  .map(item=>{
   // Duplicate scene rows can otherwise render twice after a replay/readback.
   // Sort first, then keep one occurrence of each scene ID for this item.
   const sceneIds=new Set<string>();
   const ordered=scenes.filter(s=>s&&s.content_item_id===item.id&&
    typeof s.id==='string'&&s.id.length>0&&!ambiguousScenes.has(s.id)).sort((a,b)=>
    (Number.isInteger(a.scene_number)&&Number(a.scene_number)>0?Number(a.scene_number):Number.MAX_SAFE_INTEGER)-
    (Number.isInteger(b.scene_number)&&Number(b.scene_number)>0?Number(b.scene_number):Number.MAX_SAFE_INTEGER));
   return Object.freeze({item,scenes:Object.freeze(ordered.filter(s=>{
    if(sceneIds.has(s.id))return false;
    sceneIds.add(s.id);return true;
   }))});
  }));
}
