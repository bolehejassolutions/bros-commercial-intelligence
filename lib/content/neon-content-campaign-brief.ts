/** Read-only presentation of persisted campaign brief fields, not a generation claim. */
type BriefRow=Readonly<{label:string;value:string}>;
const safe=(v:unknown,max:number)=>typeof v==='string'?v.trim().slice(0,max):'';
const allowed=new Set(['facebook','instagram','tiktok','youtube','linkedin','whatsapp','threads','x']);
export function buildContentCampaignBrief(raw:unknown):ReadonlyArray<BriefRow>{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return [];
 const c=raw as Record<string,unknown>;
 const rows:BriefRow[]=[
  {label:'Produk / servis',value:safe(c.product_service,200)},
  {label:'Sasaran pelanggan',value:safe(c.audience,2000)},
  {label:'Penerangan',value:safe(c.description,4000)},
  {label:'Masalah pelanggan',value:safe(c.problem,2000)},
  {label:'Objektif',value:safe(c.objective,2000)}
 ];
 if(Number.isInteger(c.duration_days)&&Number(c.duration_days)>=1&&Number(c.duration_days)<=90)
  rows.push({label:'Tempoh',value:String(c.duration_days)+' hari'});
 if(Array.isArray(c.platforms)){
  const platforms=[...new Set(c.platforms.filter((p):p is string=>typeof p==='string').map(p=>p.toLowerCase()).filter(p=>allowed.has(p)))];
  if(platforms.length)rows.push({label:'Platform',value:platforms.join(', ')});
 }
 return Object.freeze(rows.filter(row=>row.value).map(row=>Object.freeze(row)));
}
