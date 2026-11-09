/** Tenant-detail presentation guard: only show scenes attached to items of the selected campaign.
 * No writes, generation, publishing, or inferred content.
 */
type Item={id:string;campaign_id:string};
type Scene={id:string;content_item_id:string;scene_number?:number};
export function scopeContentCampaignItems<I extends Item,S extends Scene>(
 campaignId:string,items:readonly I[],scenes:readonly S[]
):ReadonlyArray<Readonly<{item:I;scenes:readonly S[]}>>{
 if(!campaignId||!Array.isArray(items)||!Array.isArray(scenes))return Object.freeze([]);
 const owned=items.filter(i=>i&&i.campaign_id===campaignId&&typeof i.id==='string'&&i.id.length>0);
 const unique=new Set<string>();
 return Object.freeze(owned.filter(i=>{if(unique.has(i.id))return false;unique.add(i.id);return true;})
  .map(item=>{
   // Duplicate scene rows can otherwise render twice after a replay/readback.
   // Sort first, then keep one occurrence of each scene ID for this item.
   const sceneIds=new Set<string>();
   const ordered=scenes.filter(s=>s&&s.content_item_id===item.id&&
    typeof s.id==='string'&&s.id.length>0).sort((a,b)=>
    (Number.isInteger(a.scene_number)&&Number(a.scene_number)>0?Number(a.scene_number):Number.MAX_SAFE_INTEGER)-
    (Number.isInteger(b.scene_number)&&Number(b.scene_number)>0?Number(b.scene_number):Number.MAX_SAFE_INTEGER));
   return Object.freeze({item,scenes:Object.freeze(ordered.filter(s=>{
    if(sceneIds.has(s.id))return false;
    sceneIds.add(s.id);return true;
   }))});
  }));
}
