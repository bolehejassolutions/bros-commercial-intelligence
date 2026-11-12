'use client';
/** BROS CONTENT Neon recovery cockpit: real reads and draft writes only.
 * No generative, credit, billing, campaign launch or publishing controls.
 */
import {useEffect,useRef,useState,type FormEvent} from 'react';
import ContentCreativeDraft from './content-creative-draft';
import {createContentDetailReadGuard} from '@/lib/content/content-detail-read-guard';
import {prepareContentDraftRetry,isContentDraftSaveFeedbackCurrent,shouldClearContentDraftAttempt,type ContentDraftAttempt} from '@/lib/content/neon-content-draft-retry';
import {parseContentDraftAcknowledgement} from '@/lib/content/neon-content-draft-ack-response';
import {confirmContentDraftReadback} from '@/lib/content/neon-content-draft-readback';
import {buildContentCampaignView} from '@/lib/content/neon-content-campaign-view';
import {scopeContentCampaignItems} from '@/lib/content/neon-content-campaign-items';
import {summarizeContentCampaignInventory} from '@/lib/content/neon-content-campaign-inventory';
import {filterContentCampaigns} from '@/lib/content/neon-content-campaign-search';
import {buildContentCampaignBrief} from '@/lib/content/neon-content-campaign-brief';
import {buildContentBusinessProfile} from '@/lib/content/neon-content-business-profile';
import {buildContentPublishPreview} from '@/lib/content/neon-content-publish-preview';
import {parseContentWorkspaceIndex} from '@/lib/content/neon-content-workspace-index-response';
import {parseContentWorkspaceDetail} from '@/lib/content/neon-content-workspace-detail-response';
import {contentWorkspaceReadError} from '@/lib/content/neon-content-workspace-http-error';
import {contentDraftSaveHttpError} from '@/lib/content/neon-content-draft-http-error';
import {shouldResetContentDraftOnWorkspaceSwitch,reconcileContentWorkspaceSelection} from '@/lib/content/neon-content-workspace-switch';
import {isContentWorkspaceDetailCurrent,isContentDraftWorkspaceSettled,isContentWorkspaceIndexReady} from '@/lib/content/neon-content-workspace-render-guard';
import {initialWorkspaceLoad,loadingWorkspace,loadedWorkspace,failedWorkspace,
 type WorkspaceLoadState} from '@/lib/content/neon-content-workspace-load-state';
type Workspace={id:string;name:string;updated_at?:string;business_dna?:unknown};
type Campaign={id:string;product_service?:string;audience?:string;status?:string;description?:string;problem?:string;objective?:string;duration_days?:number;platforms?:string[];created_at?:string;
 strategy?:unknown;angles?:unknown;captions?:unknown;publish_plan?:unknown;};
type ContentItem={id:string;campaign_id:string;type?:string;title?:string;body?:unknown};
type Scene={id:string;content_item_id:string;scene_number?:number;narration?:string;dialogue?:string;visual_prompt?:string;
 motion_prompt?:string;duration_seconds?:number|string;};
type Details={workspace:Workspace;campaigns:Campaign[];contentItems:ContentItem[];scenes:Scene[];nextCursor?:string|null};
type Draft={product_service:string;audience:string;description:string;problem:string;objective:string;duration_days:number;platforms:string[]};
const initialDraft:Draft={product_service:'',audience:'',description:'',problem:'',objective:'',duration_days:7,platforms:['facebook']};
const card:React.CSSProperties={background:'#14243a',border:'1px solid #34445c',borderRadius:14,padding:20};
const field:React.CSSProperties={width:'100%',padding:'11px 12px',border:'1px solid #526580',borderRadius:7,color:'#f4efe1',background:'#0c1828',font:'inherit'};
const gold='#ecd29a';
const expiredSession='Sesi tamat. Sila log masuk semula.';
function safeText(value:unknown){return typeof value==='string'&&value.trim()?value:'—';}
function readableBody(value:unknown){
 if(typeof value==='string')return safeText(value);
 if(value!==null&&typeof value==='object'){
  try{return JSON.stringify(value,null,2);}catch{return 'Tidak dapat memaparkan kandungan.';}
 }
 return '—';
}
type SavedContent=Readonly<{item:ContentItem;scenes:readonly Scene[]}>;

function CampaignLayers({campaign,content}:{campaign:Campaign;content:readonly SavedContent[]}){
 const view=buildContentCampaignView(campaign);
 const preview=buildContentPublishPreview(campaign);
 if(!view.hasGeneratedContent&&content.length===0)return <p>Belum ada kandungan tersimpan untuk kempen ini.</p>;
 const scripts=content.filter(({item})=>item.type==='script');
 const visuals=content.filter(({item})=>item.type==='visual_prompt');
 const sceneGroups=content.filter(({item,scenes})=>item.type==='video_scenes'||scenes.length>0);
 const other=content.filter(({item})=>!['script','visual_prompt','video_scenes'].includes(item.type??''));
 return <details style={{border:'1px solid #34445c',padding:12,borderRadius:8,margin:'10px 0'}}>
  <summary style={{cursor:'pointer',color:gold,fontWeight:600}}>Lihat kandungan kempen</summary>
  {(visuals.length>0||sceneGroups.length>0)&&<p style={{fontSize:12,color:'#b6c1cf'}}>
   Babak dan arahan visual dipaparkan sebagai teks. Fail media belum disahkan.
  </p>}
  <div style={{display:'grid',gap:16,marginTop:12}}>
   <OutputGroup title="Strategi" available={view.strategy.length>0||view.platformStrategy.length>0}>
    {view.strategy.map(row=><p key={row.label} style={{fontSize:13,whiteSpace:'pre-wrap',margin:'7px 0'}}>
     <strong>{row.label}: </strong>{row.value}</p>)}
    {view.platformStrategy.map((value,i)=><p key={i} style={{fontSize:13,margin:'6px 0'}}>• {value}</p>)}
   </OutputGroup>
   <OutputGroup title="Sudut kandungan" available={view.angles.length>0}>
    {view.angles.map((row,i)=><div key={i} style={{marginBottom:10,fontSize:13}}>
     <strong>{row.title||'Sudut '+(i+1)}</strong>
     {row.hook&&<p style={{margin:'3px 0'}}>Pembuka: {row.hook}</p>}
     {row.reason&&<p style={{margin:'3px 0',color:'#b6c1cf'}}>Sebab: {row.reason}</p>}
    </div>)}
   </OutputGroup>
   <OutputGroup title="Skrip" available={scripts.length>0}>
    {scripts.map(({item})=><SavedItem key={item.id} item={item}/>)}
   </OutputGroup>
   <OutputGroup title="Babak video" available={sceneGroups.length>0}>
    {sceneGroups.map(({item,scenes})=><div key={item.id} style={{background:'#0d1c2e',padding:12,borderRadius:8}}>
     <strong>{safeText(item.title)}</strong>
     {item.type==='video_scenes'&&<ItemBody item={item}/>}
     {scenes.length===0&&<p>Belum ada butiran babak.</p>}
     {scenes.map(scene=><p key={scene.id} style={{fontSize:12,borderTop:'1px solid #34445c',paddingTop:8}}>
      <strong>Babak {scene.scene_number??'—'} {scene.duration_seconds!==undefined?'· '+scene.duration_seconds+'s':''}</strong>
      <span style={{display:'block'}}>Naratif: {safeText(scene.narration)}</span>
      <span style={{display:'block'}}>Dialog: {safeText(scene.dialogue)}</span>
      <span style={{display:'block'}}>Visual: {safeText(scene.visual_prompt)}</span>
      <span style={{display:'block'}}>Gerakan: {safeText(scene.motion_prompt)}</span>
     </p>)}
    </div>)}
   </OutputGroup>
   <OutputGroup title="Arahan visual" available={visuals.length>0}>
    {visuals.map(({item})=><SavedItem key={item.id} item={item}/>)}
   </OutputGroup>
   <OutputGroup title="Kapsyen" available={view.captions.length>0}>
    {view.captions.map(row=><div key={row.platform} style={{marginBottom:10,fontSize:13}}>
     <strong style={{textTransform:'capitalize'}}>{row.platform}</strong>
     <p style={{margin:'3px 0',whiteSpace:'pre-wrap'}}>{row.caption}</p>
    </div>)}
   </OutputGroup>
   <OutputGroup title="Pelan penerbitan" available={view.publishPlan.length>0}>
    {view.publishPlan.map((row,i)=><p key={i} style={{fontSize:13,margin:'7px 0'}}>
     Hari {row.day} · {row.platform} · {row.contentType}
     {row.objective&&<span style={{color:'#b6c1cf'}}> — {row.objective}</span>}
    </p>)}
   </OutputGroup>
   {other.length>0&&<OutputGroup title="Kandungan lain" available>
    {other.map(({item})=><SavedItem key={item.id} item={item}/>)}
   </OutputGroup>}
  </div>
  {preview.length>0&&<section aria-label="Pratonton penerbitan" style={{borderTop:'1px solid #34445c',paddingTop:12}}>
   <h4 style={{margin:'0 0 6px'}}>Pratonton penerbitan</h4>
   <p style={{fontSize:12}}>Jadual dan status penerbitan tidak disahkan.</p>
   {preview.map((entry,i)=><article key={i} style={{padding:'8px 0',borderBottom:'1px solid #34445c'}}>
    <strong style={{fontSize:13}}>Hari {entry.day} · {entry.platform} · {entry.contentType||'Kandungan'}</strong>
    {entry.objective&&<p style={{fontSize:12}}>{entry.objective}</p>}
    <p style={{fontSize:12,whiteSpace:'pre-wrap'}}>{entry.captionAvailable?entry.caption:'Kapsyen platform ini belum tersedia.'}</p>
   </article>)}
  </section>}
 </details>;
}
function OutputGroup({title,available,children}:{title:string;available:boolean;children:React.ReactNode}){
 return <section>
  <h4 style={{margin:'0 0 6px'}}>{title}</h4>
  {available?children:<p style={{fontSize:13,color:'#b6c1cf'}}>Belum ada dalam rekod kempen ini.</p>}
 </section>;
}
function SavedItem({item}:{item:ContentItem}){
 return <div style={{background:'#0d1c2e',padding:12,borderRadius:8,marginBottom:8}}>
  <strong>{safeText(item.title)}</strong><ItemBody item={item}/>
 </div>;
}
function ItemBody({item}:{item:ContentItem}){
 const body=item.body;
 const obj=body!==null&&typeof body==='object'&&!Array.isArray(body)
  ?body as Record<string,unknown>:null;
 if(obj&&item.type==='script')return <div style={{fontSize:13,whiteSpace:'pre-wrap'}}>
  <p><strong>Pembuka:</strong> {safeText(obj.hook)}</p>
  <p><strong>Skrip:</strong> {safeText(obj.body)}</p>
  <p><strong>Tindakan seterusnya:</strong> {safeText(obj.cta)}</p>
 </div>;
 if(obj&&item.type==='visual_prompt')return <p style={{fontSize:13,whiteSpace:'pre-wrap'}}>
  {safeText(obj.prompt)}</p>;
 if(obj&&item.type==='video_scenes')return <p style={{fontSize:13,color:'#b6c1cf'}}>
  Jumlah babak dalam rekod: {typeof obj.count==='number'?obj.count:'—'}</p>;
 return <pre style={{whiteSpace:'pre-wrap',fontSize:12,overflowWrap:'anywhere'}}>{readableBody(body)}</pre>;
}
export default function ContentWorkspaceClient(){
 const[workspaces,setWorkspaces]=useState<Workspace[]>([]);
 const[selected,setSelected]=useState('');
 const[detailLoad,setDetailLoad]=useState<WorkspaceLoadState<Details>>(initialWorkspaceLoad);
 const[draft,setDraft]=useState<Draft>(initialDraft);
 const[loading,setLoading]=useState(true);
 const[indexError,setIndexError]=useState('');
 const[indexRefresh,setIndexRefresh]=useState(0);

 const[saving,setSaving]=useState(false);
 const[error,setError]=useState('');
 const[notice,setNotice]=useState('');
 const[refresh,setRefresh]=useState(0);
 const[campaignQuery,setCampaignQuery]=useState('');
 const[campaignPages,setCampaignPages]=useState<{workspaceId:string;cursors:string[]}>({workspaceId:'',cursors:[]});
 const pageCursors=campaignPages.workspaceId===selected?campaignPages.cursors:[];
 const before=pageCursors.at(-1);
 const pendingDraftAttempt=useRef<ContentDraftAttempt|null>(null);
 // Invalidate older campaign GET responses after a verified draft POST readback.
 const detailReadGuard=useRef(createContentDetailReadGuard());
 // Keep the currently selected tenant visible to asynchronous save completions.
 const selectedWorkspaceRef=useRef(selected);
 selectedWorkspaceRef.current=selected;
 // The index loader may replace the selected workspace after membership changes.
 // Reset tenant-scoped unsaved input for *every* selection transition, not only
 // button clicks, including index refresh fallback and loss of membership.
 const indexReady=isContentWorkspaceIndexReady(loading,indexError,selected,workspaces.map(w=>w.id));
 const previousWorkspaceRef=useRef(selected);
 useEffect(()=>{
  if(!shouldResetContentDraftOnWorkspaceSwitch(previousWorkspaceRef.current,selected))return;
  previousWorkspaceRef.current=selected;
  setDraft(initialDraft);setCampaignQuery('');setError('');setNotice('');
  setCampaignPages({workspaceId:selected,cursors:[]});
  setDetailLoad(initialWorkspaceLoad());
 },[selected]);
 useEffect(()=>{
  let active=true;
  (async()=>{
   try{
    const res=await fetch('/api/content/dev/workspaces',{cache:'no-store',credentials:'same-origin'});
    if(res.status===401)throw new Error(expiredSession);
    if(!res.ok)throw new Error('Senarai workspace belum dapat dibaca.');
    const next=parseContentWorkspaceIndex(await res.json());
    if(active){setWorkspaces(next);setSelected(previous=>reconcileContentWorkspaceSelection(previous,next.map(w=>w.id)));setIndexError('');}
   }catch(e){if(active){setWorkspaces([]);setSelected('');setIndexError(e instanceof Error?e.message:'Ralat memuatkan workspace.');}}
   finally{if(active)setLoading(false);}
  })();
  return()=>{active=false;};
 },[indexRefresh]);
 useEffect(()=>{
  if(!selected){setDetailLoad(initialWorkspaceLoad());return;}
  let active=true;const readEpoch=detailReadGuard.current.beginRead();setDetailLoad(loadingWorkspace());
  (async()=>{
   try{
    const suffix=before?'?before='+encodeURIComponent(before):'';
    const res=await fetch('/api/content/dev/workspaces/'+encodeURIComponent(selected)+suffix,{cache:'no-store',credentials:'same-origin'});
    if(!res.ok)throw new Error(contentWorkspaceReadError(res.status));
    const detail=parseContentWorkspaceDetail(await res.json(),selected);
    if(active&&detailReadGuard.current.isCurrent(readEpoch))setDetailLoad(loadedWorkspace(detail));
   }catch(e){if(active&&detailReadGuard.current.isCurrent(readEpoch))setDetailLoad(failedWorkspace(e instanceof Error?e.message:'Ralat memuatkan data.'));}
  
  })();
  return()=>{active=false;};
 },[selected,refresh,before]);
 function changeCampaignPage(cursors:string[]){
  setDetailLoad(loadingWorkspace());
  setCampaignPages({workspaceId:selected,cursors});
 }
 function togglePlatform(platform:string){
  setDraft(previous=>({...previous,platforms:previous.platforms.includes(platform)
   ?previous.platforms.filter(p=>p!==platform):[...previous.platforms,platform]}));
 }
 async function saveDraft(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(saving||!indexReady||!isContentDraftWorkspaceSettled(selected,previousWorkspaceRef.current)||draft.platforms.length===0)return;
  setSaving(true);setNotice('');setError('');
  try{
   // Preserve the server-side idempotency key if the prior POST committed but
   // its response was lost. A changed draft or workspace gets a fresh key.
   const submitted=JSON.stringify(draft);
   // The form can change while POST/readback is pending. Verify the immutable
   // submitted payload, never the latest editable form state.
   const submittedDraft:Draft=JSON.parse(submitted);
   const attempt=prepareContentDraftRetry(pendingDraftAttempt.current,selected,draft,()=>crypto.randomUUID());
   pendingDraftAttempt.current=attempt;
   const response=await fetch('/api/content/dev/workspaces/'+encodeURIComponent(selected)+'/campaign-drafts',{
    method:'POST',credentials:'same-origin',headers:{'content-type':'application/json','idempotency-key':attempt.key},
    body:submitted
   });
   if(!response.ok)throw new Error(contentDraftSaveHttpError(response.status));
   const receipt=parseContentDraftAcknowledgement(await response.json(),response.status);
   // A 201 receipt alone is not proof that the draft is independently readable.
   // Preserve the idempotency key on readback failure for a safe retry.
   const readback=await fetch('/api/content/dev/workspaces/'+encodeURIComponent(selected),{
    cache:'no-store',credentials:'same-origin'
   });
   if(!readback.ok)throw new Error('Draf diterima tetapi bacaan semula gagal. Cuba semula dengan selamat.');
   const verified=confirmContentDraftReadback(await readback.json(),selected,receipt.id,submittedDraft);
   if(isContentDraftSaveFeedbackCurrent(selected,selectedWorkspaceRef.current)){
    detailReadGuard.current.supersedeWithVerifiedDraft();
    setCampaignPages({workspaceId:selected,cursors:[]});
    setDetailLoad(loadedWorkspace(verified));
    setNotice('Draf kempen sudah disimpan. Anda boleh membukanya dalam senarai kempen.');
   }
   // A later save may have replaced this attempt while the POST was pending.
   // Never clear its retry key or mutate a different workspace's form.
   if(shouldClearContentDraftAttempt(pendingDraftAttempt.current,attempt))pendingDraftAttempt.current=null;
   if(isContentDraftSaveFeedbackCurrent(selected,selectedWorkspaceRef.current))
    setDraft(current=>JSON.stringify(current)===submitted?initialDraft:current);
   // The authenticated GET above already verified the newest page. A save
   // from an older page returns the user to the first page.
  }catch(e){if(isContentDraftSaveFeedbackCurrent(selected,selectedWorkspaceRef.current))
   setError(e instanceof Error?e.message:'Ralat menyimpan draf.');}
  finally{setSaving(false);}
 }
 return <main style={{minHeight:'100vh',background:'#091425',color:'#f4efe1',padding:'30px 18px 80px',fontFamily:'system-ui,Segoe UI,sans-serif'}}>
  <div style={{maxWidth:1080,margin:'0 auto',display:'grid',gap:22}}>
   <header style={{borderBottom:'1px solid #324258',paddingBottom:20}}>
    <h1 style={{fontSize:'clamp(28px,5vw,43px)',margin:'6px 0'}}>BROS CONTENT DEV</h1>
    <p style={{color:'#b6c1cf',maxWidth:680}}>Buka semula kempen lama atau simpan rancangan kempen baharu sebagai draf.</p>
   </header>
   {error&&<div role="alert" style={{...card,borderColor:'#ad665d',color:'#ffd0cb'}}>{error}{error===expiredSession&&
    <> <a href="/content/dev/sign-in" style={{color:gold}}>Log masuk</a></>}</div>}
   {notice&&<div role="status" style={{...card,borderColor:'#679c88'}}>{notice}</div>}
   <section style={card} aria-label="Pilih ruang kerja">
    <h2 style={{fontSize:19,marginTop:0}}>Ruang kerja</h2>
    {loading?<p role="status">Sedang memuatkan…</p>:indexError?<div role="alert" style={{border:'1px solid #ad665d',padding:12,borderRadius:8}}>
     <p style={{color:'#ffd0cb'}}>{indexError}</p>
     {indexError===expiredSession&&<p><a href="/content/dev/sign-in" style={{color:gold}}>Log masuk</a></p>}
     <button type="button" onClick={()=>{setLoading(true);setIndexError('');setIndexRefresh(n=>n+1);}}
      style={{background:gold,color:'#111b29',padding:'9px 13px',border:0,borderRadius:7,cursor:'pointer'}}>Cuba semula senarai workspace</button>
    </div>:workspaces.length===0?<p>Tiada workspace yang dipautkan kepada identiti Neon Auth ini. Semak keahlian CONTENT sebelum meneruskan.</p>:
    <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>{workspaces.map(workspace=><button key={workspace.id} type="button"
     onClick={()=>{if(shouldResetContentDraftOnWorkspaceSwitch(selected,workspace.id))setSelected(workspace.id);}}
     aria-pressed={selected===workspace.id}
     style={{border:'1px solid '+(selected===workspace.id?gold:'#526580'),background:selected===workspace.id?'#39432e':'#1a2b43',color:'#f4efe1',padding:'10px 16px',borderRadius:8,cursor:'pointer'}}>
     {workspace.name}</button>)}</div>}
   </section>
   {indexReady&&detailLoad.status==='ready'&&isContentWorkspaceDetailCurrent(selected,detailLoad)&&
    <BusinessProfile data={detailLoad.data.workspace.business_dna}/>}
   {indexReady&&<div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,420px),1fr))',gap:20,alignItems:'start'}}>
    <section style={card}>
     <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap'}}>
      <h2 style={{fontSize:20,marginTop:0}}>Kempen sedia ada</h2>
      <button type="button" aria-label="Muat semula kempen workspace ini"
       disabled={saving||detailLoad.status==='loading'||!isContentDraftWorkspaceSettled(selected,previousWorkspaceRef.current)}
       onClick={()=>setRefresh(value=>value+1)}
       style={{background:'#1a2b43',color:gold,border:'1px solid #526580',padding:'8px 12px',borderRadius:7,cursor:'pointer'}}>
       Muat semula kempen
      </button>
     </div>
     <label style={{display:'grid',gap:6,margin:'12px 0',fontSize:13}}>
      Cari kempen pada halaman ini
      <input type="search" value={campaignQuery} onChange={event=>setCampaignQuery(event.target.value)}
       placeholder="Produk, sasaran, status atau objektif" style={field}/>
     </label>
     {detailLoad.status==='loading'||detailLoad.status==='idle'||(detailLoad.status==='ready'&&!isContentWorkspaceDetailCurrent(selected,detailLoad))?<p role="status">Memuatkan kempen…</p>:
      detailLoad.status!=='ready'?<div role="alert" style={{border:'1px solid #ad665d',padding:12,borderRadius:8}}>
       <p style={{color:'#ffd0cb'}}>{detailLoad.error}</p>
       {detailLoad.error===expiredSession&&<p><a href="/content/dev/sign-in" style={{color:gold}}>Log masuk</a></p>}
       <button type="button" onClick={()=>setRefresh(value=>value+1)}
        style={{background:gold,color:'#111b29',padding:'9px 13px',border:0,borderRadius:7,cursor:'pointer'}}>
        Cuba semula</button>
      </div>:
      detailLoad.data.campaigns.length===0?<p>Belum ada kempen dalam workspace ini.</p>:
      filterContentCampaigns(detailLoad.data.campaigns,campaignQuery).length===0?<p>Tiada kempen sepadan. Kosongkan carian untuk lihat semua kempen.</p>:
     <div style={{display:'grid',gap:12}}>{filterContentCampaigns(detailLoad.data.campaigns,campaignQuery).map(c=>{
      const scopedItems=scopeContentCampaignItems(c.id,detailLoad.data.contentItems,detailLoad.data.scenes);
      const inventory=summarizeContentCampaignInventory(scopedItems);
      return <article key={c.id} style={{borderTop:'1px solid #34445c',paddingTop:12}}>
       <p style={{fontSize:11,color:gold,margin:'0 0 6px'}}>{c.status==='draft'?'Draf':c.status==='completed'?'Status rekod: selesai':safeText(c.status)}</p>
       <h3 style={{fontSize:17,margin:'4px 0 8px'}}>{safeText(c.product_service)}</h3>
       {scopedItems.length>0&&<p style={{fontSize:12,color:'#b6c1cf',margin:'0 0 8px'}}>
        {inventory.scripts} skrip · {inventory.visualPrompts} arahan visual · {inventory.scenes} babak · {inventory.other} item lain
       </p>}
       <details style={{margin:'8px 0'}}><summary style={{cursor:'pointer',color:gold,fontSize:13}}>Lihat butiran asal kempen</summary>
        <dl style={{margin:'10px 0',display:'grid',gap:8}}>
         {buildContentCampaignBrief(c).map(row=><div key={row.label}>
          <dt style={{fontSize:11,color:'#b6c1cf'}}>{row.label}</dt>
          <dd style={{margin:0,fontSize:13,whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{row.value}</dd>
         </div>)}
        </dl>
       </details>
       <CampaignLayers campaign={c} content={scopedItems}/>
       <ContentCreativeDraft businessDna={detailLoad.data.workspace.business_dna} campaign={c}/>
      </article>})}</div>}
     {(pageCursors.length>0||(detailLoad.status==='ready'&&detailLoad.data.nextCursor))&&<nav aria-label="Halaman kempen" style={{display:'flex',gap:10,marginTop:14}}>
       <button type="button" disabled={saving||detailLoad.status==='loading'||pageCursors.length===0} onClick={()=>changeCampaignPage(pageCursors.slice(0,-1))}>
        Halaman sebelumnya
       </button>
       {detailLoad.status==='ready'&&detailLoad.data.nextCursor&&<button type="button" disabled={saving}
        onClick={()=>changeCampaignPage([...pageCursors,detailLoad.data.nextCursor!])}>Halaman seterusnya</button>}
      </nav>}
    </section>
    {isContentDraftWorkspaceSettled(selected,previousWorkspaceRef.current)?<section style={card}>
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
      <button disabled={saving||!indexReady||draft.platforms.length===0} type="submit"
       style={{background:gold,border:0,borderRadius:8,color:'#111b29',fontWeight:700,padding:13,cursor:'pointer'}}>
       {saving?'Menyimpan…':'Simpan draf kempen'}
      </button>
      <p style={{fontSize:12,color:'#b6c1cf'}}>Draf ini menyimpan butiran kempen untuk semakan.</p>
     </form>
    </section>:<section style={card} role="status">Menukar workspace dan mengosongkan draf sebelumnya…</section>}
   </div>}
  </div>
 </main>;
}

function BusinessProfile({data}:{data:unknown}){
 const fields=buildContentBusinessProfile(data);
 return <section style={card}>
  <h2 style={{fontSize:20,marginTop:0}}>Profil perniagaan (Business DNA)</h2>
  {fields.length===0?<p>Belum ada profil perniagaan tersimpan dalam ruang kerja ini.</p>:
   <dl style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,240px),1fr))',gap:16,marginBottom:0}}>
    {fields.map(({label,value})=><div key={label}>
     <dt style={{fontWeight:600,color:gold}}>{label}</dt>
     <dd style={{fontSize:13,whiteSpace:'pre-wrap',overflowWrap:'anywhere',margin:'6px 0 0'}}>{value}</dd>
    </div>)}
   </dl>}
 </section>;
}
