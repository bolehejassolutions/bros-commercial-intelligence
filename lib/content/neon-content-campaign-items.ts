/** Tenant-detail presentation guard: only show scenes attached to items of the selected campaign.
 * No writes, generation, publishing, or inferred content.
 */
type Item={id:string;campaign_id:string};
type Scene={id:string;content_item_id:string;scene_number?:number};
// PostgreSQL JSONB does not guarantee object-key insertion order on readback.
// Compare semantic JSON payloads, not JavaScript property insertion order.
function canonicalJson(value:unknown):string{
 const seen=new Set<object>();
 const normalize=(v:unknown):unknown=>{
  if(v===null||typeof v==='string'||typeof v==='boolean')return v;
  if(typeof v==='number'&&Number.isFinite(v))return v;
  if(!v||typeof v!=='object'||seen.has(v))throw new Error('invalid JSON payload');
  const proto=Object.getPrototypeOf(v);
  if(!Array.isArray(v)&&proto!==Object.prototype&&proto!==null)throw new Error('invalid JSON object');
  // Never invoke getters while fingerprinting nested untrusted readback data.
  const descriptors=Object.getOwnPropertyDescriptors(v);
  if(Object.values(descriptors).some(d=>!('value' in d)))throw new Error('accessor in JSON payload');
  seen.add(v);
  const result=Array.isArray(v)
   ? Array.from({length:v.length},(_,i)=>{
      const d=descriptors[String(i)];
      if(!d||!('value' in d))throw new Error('sparse JSON array');
      return normalize(d.value);
     })
   : Object.fromEntries(Object.keys(descriptors).sort().map(key=>{
      const d=descriptors[key];
      return [key,normalize(d.value)];
     }));
  seen.delete(v);
  return result;
 };
 return JSON.stringify(normalize(value));
}
// PostgreSQL JSONB rows are plain data. Reject accessor/prototype-backed rows
// before any property reads, including the later filter and sort passes.
function isPlainDataRow(value:unknown):boolean{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const proto=Object.getPrototypeOf(value);
 if(proto!==Object.prototype&&proto!==null)return false;
 return Object.values(Object.getOwnPropertyDescriptors(value)).every(d=>'value' in d);
}
export function scopeContentCampaignItems<I extends Item,S extends Scene>(
 campaignId:string,items:readonly I[],scenes:readonly S[]
):ReadonlyArray<Readonly<{item:I;scenes:readonly S[]}>>{
 if(!campaignId||!Array.isArray(items)||!Array.isArray(scenes))return Object.freeze([]);
 const safeItems=items.filter(isPlainDataRow);
 const safeScenes=scenes.filter(isPlainDataRow);
 // A scene carries only content_item_id. If the same item ID is claimed by
 // another campaign, its scene ownership cannot be established safely.
 const ambiguous=new Set<string>();
 const ownership=new Map<string,string>();
 const itemFingerprint=new Map<string,string>();
 for(const item of safeItems){
  if(!item||typeof item.id!=='string'||!item.id.length||typeof item.campaign_id!=='string')continue;
  const prior=ownership.get(item.id);
  if(prior!==undefined&&prior!==item.campaign_id)ambiguous.add(item.id);
  else ownership.set(item.id,item.campaign_id);
  // Replayed item IDs with conflicting payloads cannot be safely displayed.
  // Suppress every copy rather than picking whichever arrived first.
  let fingerprint:string;
  try{fingerprint=canonicalJson(item);}catch{ambiguous.add(item.id);continue;}
  const previous=itemFingerprint.get(item.id);
  if(previous!==undefined&&previous!==fingerprint)ambiguous.add(item.id);
  else itemFingerprint.set(item.id,fingerprint);
 }
 // Scene identifiers must not be attributed to two different content items.
 // A malformed or mixed readback must never guess which item owns the scene.
 const sceneOwner=new Map<string,string>();
 const sceneFingerprint=new Map<string,string>();
 const ambiguousScenes=new Set<string>();
 for(const scene of safeScenes){
  if(!scene||typeof scene.id!=='string'||!scene.id.length||typeof scene.content_item_id!=='string')continue;
  const prior=sceneOwner.get(scene.id);
  if(prior!==undefined&&prior!==scene.content_item_id)ambiguousScenes.add(scene.id);
  else sceneOwner.set(scene.id,scene.content_item_id);
  // Same-ID replay rows must agree on the complete scene payload. Otherwise
  // choosing the first row could display a stale or tampered script/visual.
  // JSONB readbacks are plain JSON; serialization is deterministic per row.
  let fingerprint:string;
  try{fingerprint=canonicalJson(scene);}catch{ambiguousScenes.add(scene.id);continue;}
  const previous=sceneFingerprint.get(scene.id);
  if(previous!==undefined&&previous!==fingerprint)ambiguousScenes.add(scene.id);
  else sceneFingerprint.set(scene.id,fingerprint);
 }
 const owned=safeItems.filter(i=>i&&i.campaign_id===campaignId&&typeof i.id==='string'&&i.id.length>0&&!ambiguous.has(i.id));
 const unique=new Set<string>();
 return Object.freeze(owned.filter(i=>{if(unique.has(i.id))return false;unique.add(i.id);return true;})
  .map(item=>{
   // Duplicate scene rows can otherwise render twice after a replay/readback.
   // Sort first, then keep one occurrence of each scene ID for this item.
   const sceneIds=new Set<string>();
   const ordered=safeScenes.filter(s=>s&&s.content_item_id===item.id&&
    typeof s.id==='string'&&s.id.length>0&&!ambiguousScenes.has(s.id)).sort((a,b)=>
    (Number.isInteger(a.scene_number)&&Number(a.scene_number)>0?Number(a.scene_number):Number.MAX_SAFE_INTEGER)-
    (Number.isInteger(b.scene_number)&&Number(b.scene_number)>0?Number(b.scene_number):Number.MAX_SAFE_INTEGER));
   return Object.freeze({item,scenes:Object.freeze(ordered.filter(s=>{
    if(sceneIds.has(s.id))return false;
    sceneIds.add(s.id);return true;
   }))});
  }));
}
