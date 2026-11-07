'use client';
import {useState, type FormEvent} from 'react';

type Campaign={id:string;product_service:string;audience:string;status:string;strategy?:unknown;angles?:unknown;captions?:unknown;publish_plan?:unknown};
type Workspace={workspace:{id:string;name:string;business_dna?:unknown};campaigns:Campaign[];contentItems:Array<{id:string;campaign_id:string;title?:string;body?:string;type?:string}>;scenes:Array<{id:string;content_item_id:string;scene_number:number;visual_prompt?:string;dialogue?:string}>};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export default function ContentRecoveryPage(){
 const [id,setId]=useState(''),[data,setData]=useState<Workspace|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [product,setProduct]=useState(''),[audience,setAudience]=useState(''),[platform,setPlatform]=useState('facebook');
 const [description,setDescription]=useState('');
 async function load(workspaceId=id){
  if(!UUID.test(workspaceId)){setError('Enter a valid workspace UUID.');return;}
  setBusy(true);setError('');setData(null);
  try{const r=await fetch('/api/content/dev/workspaces/'+encodeURIComponent(workspaceId),{credentials:'same-origin',cache:'no-store'});
   if(!r.ok){setError(r.status===401?'Sign in with the verified CONTENT account first.':r.status===404?'Workspace unavailable or access denied.':'CONTENT service unavailable ('+r.status+').');return;}
   const json=await r.json();setData(json.data);
  }catch{setError('Network request failed.');}finally{setBusy(false);}
 }
 async function create(e:FormEvent){
  e.preventDefault();if(!UUID.test(id)||!data||busy)return;
  setBusy(true);setError('');
  try{
   const bytes=new Uint8Array(18);crypto.getRandomValues(bytes);
   const key='draft_'+Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
   const r=await fetch('/api/content/dev/workspaces/'+encodeURIComponent(id)+'/campaign-drafts',{
    method:'POST',credentials:'same-origin',headers:{'content-type':'application/json','idempotency-key':key},
    body:JSON.stringify({product_service:product,audience,description,problem:'',objective:'',duration_days:7,platforms:[platform]})
   });
   if(!r.ok){setError(r.status===401?'Session expired.':r.status===404?'Workspace unavailable or access denied.':'Draft was not saved ('+r.status+').');return;}
   setProduct('');setAudience('');setDescription('');await load(id);
  }catch{setError('Draft request failed. Check the workspace before retrying to avoid duplicate submissions.');}
  finally{setBusy(false);}
 }
 return <main style={{maxWidth:1000,margin:'3rem auto',padding:'1.5rem',fontFamily:'system-ui'}}>
  <p>BROS CONTENT / RESTRICTED DEVELOPMENT</p><h1>Campaign workspace</h1>
  <p>Neon recovery workspace. Drafts only: no AI generation, credits, payments or publishing.</p>
  <label htmlFor="workspace">Workspace ID</label>
  <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
   <input id="workspace" aria-label="Workspace UUID" value={id} onChange={e=>setId(e.target.value.trim())} placeholder="Workspace UUID" style={{flex:1,minWidth:240}}/>
   <button disabled={busy} onClick={()=>void load()}>Open workspace</button>
  </div>
  {error&&<p role="alert">{error}</p>}
  {busy&&<p role="status">Processing…</p>}
  {data&&<><h2>{data.workspace.name}</h2><h3>Campaign history ({data.campaigns.length})</h3>
   {data.campaigns.length===0&&<p>No campaigns saved.</p>}
   {data.campaigns.map(c=><article key={c.id} style={{border:'1px solid #888',borderRadius:8,padding:16,marginBottom:16}}>
    <h4>{c.product_service} — {c.status}</h4><p>Audience: {c.audience}</p>
    {(['strategy','angles','captions','publish_plan'] as const).map(k=>c[k]!=null&&<details key={k}><summary>{k.replace('_',' ')}</summary><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{typeof c[k]==='string'?c[k]:JSON.stringify(c[k],null,2)}</pre></details>)}
    {data.contentItems.filter(x=>x.campaign_id===c.id).map(item=><details key={item.id}><summary>{item.title||item.type||'Content item'}</summary><p style={{whiteSpace:'pre-wrap'}}>{item.body}</p>
     {data.scenes.filter(s=>s.content_item_id===item.id).map(s=><section key={s.id}><strong>Scene {s.scene_number}</strong><p>{s.dialogue}</p><p>{s.visual_prompt}</p></section>)}
    </details>)}
   </article>)}
   <h3>Create campaign draft</h3><form onSubmit={e=>void create(e)} style={{display:'grid',gap:12}}>
    <label>Product or service<input required maxLength={200} value={product} onChange={e=>setProduct(e.target.value)}/></label>
    <label>Audience<input required maxLength={2000} value={audience} onChange={e=>setAudience(e.target.value)}/></label>
    <label>Description<textarea maxLength={4000} value={description} onChange={e=>setDescription(e.target.value)}/></label>
    <label>Platform<select value={platform} onChange={e=>setPlatform(e.target.value)}><option value="facebook">Facebook</option><option value="instagram">Instagram</option><option value="tiktok">TikTok</option><option value="youtube">YouTube</option></select></label>
    <button type="submit" disabled={busy||!product.trim()||!audience.trim()}>Save draft (no generation)</button>
   </form>
  </>}
 </main>;
}
