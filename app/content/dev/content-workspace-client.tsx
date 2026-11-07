'use client';
/** BROS CONTENT Neon recovery cockpit: real reads and draft writes only.
 * No generative, credit, billing, campaign launch or publishing controls.
 */
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {prepareContentDraftRetry,type ContentDraftAttempt} from '@/lib/content/neon-content-draft-retry';
import {buildContentCampaignView} from '@/lib/content/neon-content-campaign-view';
type Workspace={id:string;name:string;updated_at?:string};
type Campaign={id:string;product_service?:string;audience?:string;status?:string;description?:string;created_at?:string;
 strategy?:unknown;angles?:unknown;captions?:unknown;publish_plan?:unknown;};
type ContentItem={id:string;campaign_id:string;type?:string;title?:string;body?:unknown};
type Scene={id:string;content_item_id:string;scene_number?:number;narration?:string;dialogue?:string;visual_prompt?:string;
 motion_prompt?:string;duration_seconds?:number|string;};
type Details={workspace:Workspace;campaigns:Campaign[];contentItems:ContentItem[];scenes:Scene[]};
type Draft={product_service:string;audience:string;description:string;problem:string;objective:string;duration_days:number;platforms:string[]};
const initialDraft:Draft={product_service:'',audience:'',description:'',problem:'',objective:'',duration_days:7,platforms:['facebook']};
const card:React.CSSProperties={background:'#14243a',border:'1px solid #34445c',borderRadius:14,padding:20};
const field:React.CSSProperties={width:'100%',padding:'11px 12px',border:'1px solid #526580',borderRadius:7,color:'#f4efe1',background:'#0c1828',font:'inherit'};
const gold='#ecd29a';
function safeText(value:unknown){return typeof value==='string'&&value.trim()?value:'—';}
function readableBody(value:unknown){
 if(typeof value==='string')return safeText(value);
 if(value!==null&&typeof value==='object'){
  try{return JSON.stringify(value,null,2);}catch{return 'Tidak dapat memaparkan kandungan.';}
 }
 return '—';
}
function CampaignLayers({campaign}:{campaign:Campaign}){
 const view=buildContentCampaignView(campaign);
 if(!view.hasGeneratedContent)return null;
 return <details style={{border:'1px solid #34445c',padding:12,borderRadius:8,margin:'10px 0'}}>
  <summary style={{cursor:'pointer',color:gold,fontWeight:600}}>Lihat strategi, sudut, kapsyen & pelan penerbitan</summary>
  <div style={{display:'grid',gap:16,marginTop:12}}>
   {(view.strategy.length>0||view.platformStrategy.length>0)&&<section>
    <h4 style={{margin:'0 0 6px'}}>1. Strategi</h4>
    {view.strategy.map(row=><p key={row.label} style={{fontSize:13,whiteSpace:'pre-wrap',margin:'7px 0'}}>
     <strong>{row.label}: </strong>{row.value}</p>)}
    {view.platformStrategy.map((value,i)=><p key={i} style={{fontSize:13,margin:'6px 0'}}>• {value}</p>)}
   </section>}
   {view.angles.length>0&&<section>
    <h4 style={{margin:'0 0 6px'}}>2. Sudut kandungan</h4>
    {view.angles.map((row,i)=><div key={i} style={{marginBottom:10,fontSize:13}}>
     <strong>{row.title||'Sudut '+(i+1)}</strong>
     {row.hook&&<p style={{margin:'3px 0'}}>Hook: {row.hook}</p>}
     {row.reason&&<p style={{margin:'3px 0',color:'#b6c1cf'}}>Sebab: {row.reason}</p>}
    </div>)}
   </section>}
   {view.captions.length>0&&<section>
    <h4 style={{margin:'0 0 6px'}}>6. Kapsyen mengikut platform</h4>
    {view.captions.map(row=><div key={row.platform} style={{marginBottom:10,fontSize:13}}>
     <strong style={{textTransform:'capitalize'}}>{row.platform}</strong>
     <p style={{margin:'3px 0',whiteSpace:'pre-wrap'}}>{row.caption}</p>
    </div>)}
   </section>}
   {view.publishPlan.length>0&&<section>
    <h4 style={{margin:'0 0 6px'}}>7. Pelan penerbitan (paparan sahaja)</h4>
    {view.publishPlan.map((row,i)=><p key={i} style={{fontSize:13,margin:'7px 0'}}>
     Hari {row.day} · {row.platform} · {row.contentType}
     {row.objective&&<span style={{color:'#b6c1cf'}}> — {row.objective}</span>}
    </p>)}
   </section>}
  </div>
  <p style={{fontSize:11,color:'#b6c1cf'}}>Paparan bacaan sahaja. Tiada penjadualan atau penerbitan aktif.</p>
 </details>;
}
function ItemBody({item}:{item:ContentItem}){
 const body=item.body;
 const obj=body!==null&&typeof body==='object'&&!Array.isArray(body)
  ?body as Record<string,unknown>:null;
 if(obj&&item.type==='script')return <div style={{fontSize:13,whiteSpace:'pre-wrap'}}>
  <p><strong>Hook:</strong> {safeText(obj.hook)}</p>
  <p><strong>Skrip:</strong> {safeText(obj.body)}</p>
  <p><strong>CTA:</strong> {safeText(obj.cta)}</p>
 </div>;
 if(obj&&item.type==='visual_prompt')return <p style={{fontSize:13,whiteSpace:'pre-wrap'}}>
  <strong>Prompt visual:</strong> {safeText(obj.prompt)}</p>;
 if(obj&&item.type==='video_scenes')return <p style={{fontSize:13,color:'#b6c1cf'}}>
  Koleksi scene: {typeof obj.count==='number'?obj.count:'—'}</p>;
 return <pre style={{whiteSpace:'pre-wrap',fontSize:12,overflowWrap:'anywhere'}}>{readableBody(body)}</pre>;
}
export default function ContentWorkspaceClient(){
 const[workspaces,setWorkspaces]=useState<Workspace[]>([]);
 const[selected,setSelected]=useState('');
 const[details,setDetails]=useState<Details|null>(null);
 const[draft,setDraft]=useState<Draft>(initialDraft);
 const[loading,setLoading]=useState(true);
 const[loadingDetail,setLoadingDetail]=useState(false);
 const[saving,setSaving]=useState(false);
 const[error,setError]=useState('');
 const[notice,setNotice]=useState('');
 const[refresh,setRefresh]=useState(0);
 const pendingDraftAttempt=useRef<ContentDraftAttempt|null>(null);
 useEffect(()=>{
  let active=true;
  (async()=>{
   try{
    const res=await fetch('/api/content/dev/workspaces',{cache:'no-store',credentials:'same-origin'});
    if(res.status===401)throw new Error('Sesi tamat. Sila log masuk semula.');
    if(!res.ok)throw new Error('Senarai workspace belum dapat dibaca.');
    const response=await res.json() as {data?:{workspaces?:Workspace[]}};
    const next=Array.isArray(response.data?.workspaces)?response.data.workspaces:[];
    if(active){setWorkspaces(next);setSelected(previous=>next.some(w=>w.id===previous)?previous:(next[0]?.id??''));setError('');}
   }catch(e){if(active)setError(e instanceof Error?e.message:'Ralat memuatkan workspace.');}
   finally{if(active)setLoading(false);}
  })();
  return()=>{active=false;};
 },[]);
 useEffect(()=>{
  if(!selected){setDetails(null);return;}
  let active=true;setLoadingDetail(true);
  (async()=>{
   try{
    const res=await fetch('/api/content/dev/workspaces/'+encodeURIComponent(selected),{cache:'no-store',credentials:'same-origin'});
    if(!res.ok)throw new Error(res.status===401?'Sesi tamat. Sila log masuk semula.':'Data kempen belum dapat dibaca.');
    const response=await res.json() as {data?:Details};
    if(active){setDetails(response.data??null);setError('');}
   }catch(e){if(active){setDetails(null);setError(e instanceof Error?e.message:'Ralat memuatkan data.');}}
   finally{if(active)setLoadingDetail(false);}
  })();
  return()=>{active=false;};
 },[selected,refresh]);
 function togglePlatform(platform:string){
  setDraft(previous=>({...previous,platforms:previous.platforms.includes(platform)
   ?previous.platforms.filter(p=>p!==platform):[...previous.platforms,platform]}));
 }
 async function saveDraft(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(saving||!selected||draft.platforms.length===0)return;
  setSaving(true);setNotice('');setError('');
  try{
   // Preserve the server-side idempotency key if the prior POST committed but
   // its response was lost. A changed draft or workspace gets a fresh key.
   const submitted=JSON.stringify(draft);
   const attempt=prepareContentDraftRetry(pendingDraftAttempt.current,selected,draft,()=>crypto.randomUUID());
   pendingDraftAttempt.current=attempt;
   const response=await fetch('/api/content/dev/workspaces/'+encodeURIComponent(selected)+'/campaign-drafts',{
    method:'POST',credentials:'same-origin',headers:{'content-type':'application/json','idempotency-key':attempt.key},
    body:submitted
   });
   if(!response.ok)throw new Error(response.status===401?'Sesi tamat. Sila log masuk semula.':
    response.status===404?'Akses workspace tidak dibenarkan.':'Draf tidak dapat disimpan. Sila cuba lagi.');
   setNotice('Draf kempen berjaya disimpan dalam Neon DEV. Tiada kandungan dijana atau diterbitkan.');
   pendingDraftAttempt.current=null;
   setDraft(current=>JSON.stringify(current)===submitted?initialDraft:current);
   setRefresh(value=>value+1);
  }catch(e){setError(e instanceof Error?e.message:'Ralat menyimpan draf.');}
  finally{setSaving(false);}
 }
 return <main style={{minHeight:'100vh',background:'#091425',color:'#f4efe1',padding:'30px 18px 80px',fontFamily:'system-ui,Segoe UI,sans-serif'}}>
  <div style={{maxWidth:1080,margin:'0 auto',display:'grid',gap:22}}>
   <header style={{borderBottom:'1px solid #324258',paddingBottom:20}}>
    <p style={{letterSpacing:3,fontSize:11,color:gold}}>BROS / CONTENT / INTERNAL DEV</p>
    <h1 style={{fontSize:'clamp(28px,5vw,43px)',margin:'6px 0'}}>Content Workspace</h1>
    <p style={{color:'#b6c1cf',maxWidth:680}}>Pulihkan kempen dan kandungan asal daripada Neon. Fungsi tersedia: semak workspace, baca kempen dan simpan draf. Penjanaan AI, kredit dan penerbitan kekal tidak aktif.</p>
   </header>
   {error&&<div role="alert" style={{...card,borderColor:'#ad665d',color:'#ffd0cb'}}>{error} <a href="/content/dev/sign-in" style={{color:gold}}>Log masuk</a></div>}
   {notice&&<div role="status" style={{...card,borderColor:'#679c88'}}>{notice}</div>}
   <section style={card} aria-label="Pilih workspace">
    <h2 style={{fontSize:19,marginTop:0}}>Workspace</h2>
    {loading?<p>Sedang memuatkan…</p>:workspaces.length===0?<p>Tiada workspace yang dipautkan kepada identiti Neon Auth ini. Semak keahlian CONTENT sebelum meneruskan.</p>:
    <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>{workspaces.map(workspace=><button key={workspace.id} type="button"
     onClick={()=>{setSelected(workspace.id);setNotice('');}}
     aria-pressed={selected===workspace.id}
     style={{border:'1px solid '+(selected===workspace.id?gold:'#526580'),background:selected===workspace.id?'#39432e':'#1a2b43',color:'#f4efe1',padding:'10px 16px',borderRadius:8,cursor:'pointer'}}>
     {workspace.name}</button>)}</div>}
   </section>
   {selected&&<div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,420px),1fr))',gap:20,alignItems:'start'}}>
    <section style={card}>
     <h2 style={{fontSize:20,marginTop:0}}>Kempen sedia ada</h2>
     {loadingDetail?<p>Memuatkan kempen…</p>:!details?.campaigns?.length?<p>Belum ada kempen dalam workspace ini.</p>:
     <div style={{display:'grid',gap:12}}>{details.campaigns.map(c=>{
      const items=details.contentItems?.filter(i=>i.campaign_id===c.id)??[];
      return <article key={c.id} style={{borderTop:'1px solid #34445c',paddingTop:12}}>
       <p style={{fontSize:11,letterSpacing:1,color:gold,margin:'0 0 6px'}}>{safeText(c.status).toUpperCase()} · {items.length} KANDUNGAN</p>
       <h3 style={{fontSize:17,margin:'4px 0 8px'}}>{safeText(c.product_service)}</h3>
       <p style={{color:'#b6c1cf',fontSize:13}}>{safeText(c.description||c.audience)}</p>
       <CampaignLayers campaign={c}/>
       {items.length>0&&<details><summary style={{cursor:'pointer',color:gold}}>Lihat skrip, visual dan scene</summary>
        <div style={{display:'grid',gap:10,marginTop:10}}>{items.map(item=>{
         const scenes=details.scenes?.filter(s=>s.content_item_id===item.id)??[];
         return <div key={item.id} style={{background:'#0d1c2e',padding:12,borderRadius:8}}>
          <p style={{fontSize:11,color:'#b6c1cf'}}>{safeText(item.type)}</p>
          <strong>{safeText(item.title)}</strong><ItemBody item={item}/>
          {scenes.length>0&&<details><summary style={{cursor:'pointer',fontSize:12,color:gold}}>{scenes.length} scene</summary>
           {scenes.map(scene=><p key={scene.id} style={{fontSize:12,borderTop:'1px solid #34445c',paddingTop:8}}>
            <strong>Scene {scene.scene_number??'—'} {scene.duration_seconds!==undefined?'· '+scene.duration_seconds+'s':''}</strong>
            <span style={{display:'block'}}>Naratif: {safeText(scene.narration)}</span>
            <span style={{display:'block'}}>Dialog: {safeText(scene.dialogue)}</span>
            <span style={{display:'block'}}>Visual: {safeText(scene.visual_prompt)}</span>
            <span style={{display:'block'}}>Gerakan: {safeText(scene.motion_prompt)}</span>
           </p>)}
          </details>}
         </div>})}</div></details>}
      </article>})}</div>}
    </section>
    <section style={card}>
     <p style={{fontSize:11,color:gold,letterSpacing:2}}>DRAFT ONLY</p>
     <h2 style={{fontSize:20,marginTop:0}}>Draf kempen baharu</h2>
     <form onSubmit={saveDraft} style={{display:'grid',gap:14}}>
      <label>Produk / servis *<input required maxLength={200} style={field} value={draft.product_service}
       onChange={e=>setDraft(d=>({...d,product_service:e.target.value}))}/></label>
      <label>Sasaran pelanggan *<textarea required maxLength={2000} rows={2} style={field} value={draft.audience}
       onChange={e=>setDraft(d=>({...d,audience:e.target.value}))}/></label>
      <label>Penerangan<textarea maxLength={4000} rows={3} style={field} value={draft.description}
       onChange={e=>setDraft(d=>({...d,description:e.target.value}))}/></label>
      <label>Masalah pelanggan<textarea maxLength={2000} rows={2} style={field} value={draft.problem}
       onChange={e=>setDraft(d=>({...d,problem:e.target.value}))}/></label>
      <label>Objektif<textarea maxLength={2000} rows={2} style={field} value={draft.objective}
       onChange={e=>setDraft(d=>({...d,objective:e.target.value}))}/></label>
      <label>Tempoh (hari)<input type="number" min={1} max={90} style={field} value={draft.duration_days}
       onChange={e=>setDraft(d=>({...d,duration_days:Number(e.target.value)}))}/></label>
      <fieldset style={{border:'1px solid #34445c',borderRadius:9}}>
       <legend>Platform *</legend>
       {['facebook','instagram','tiktok','youtube','linkedin','whatsapp'].map(p=><label key={p} style={{display:'inline-flex',alignItems:'center',gap:5,margin:'8px 12px 8px 0',textTransform:'capitalize'}}>
        <input type="checkbox" checked={draft.platforms.includes(p)} onChange={()=>togglePlatform(p)}/>{p}</label>)}
      </fieldset>
      <button disabled={saving||draft.platforms.length===0} type="submit"
       style={{background:gold,border:0,borderRadius:8,color:'#111b29',fontWeight:700,padding:13,cursor:'pointer'}}>
       {saving?'Menyimpan…':'Simpan draf kempen'}
      </button>
      <p style={{fontSize:12,color:'#b6c1cf'}}>Menyimpan draf sahaja. Tiada penjanaan visual, penggunaan kredit atau penerbitan automatik.</p>
     </form>
    </section>
   </div>}
  </div>
 </main>;
}
