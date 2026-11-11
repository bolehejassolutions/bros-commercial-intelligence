/** Read-only inventory of recovered campaign content. Never implies media generation or approval. */
type Item={type?:string;id:string};
type Scoped={item:Item;scenes:ReadonlyArray<{id:string}>};
export function summarizeContentCampaignInventory(rows:ReadonlyArray<Scoped>){
 const counts={scripts:0,visualPrompts:0,sceneGroups:0,scenes:0,other:0};
 const seen=new Set<string>();
 for(const row of rows){
  if(!row||!row.item||typeof row.item.id!=='string'||seen.has(row.item.id))continue;
  seen.add(row.item.id);
  if(row.item.type==='script')counts.scripts++;
  else if(row.item.type==='visual_prompt')counts.visualPrompts++;
  else if(row.item.type==='video_scenes')counts.sceneGroups++;
  else counts.other++;
  counts.scenes+=new Set((Array.isArray(row.scenes)?row.scenes:[]).map(s=>s.id).filter(id=>typeof id==='string')).size;
 }
 return Object.freeze(counts);
}
