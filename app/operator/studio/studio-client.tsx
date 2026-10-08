"use client";
import {useEffect,useState,type FormEvent} from "react";

type Plan={
 id:string;name:string;status:string;created_at:string;objective:string;
 headline:string;primary_text:string;description:string;page_id:string;image_hash:string;
 pixel_id:string|null;duration_days:number;budget_cap_myr:number|string;
 authorization_expires_at:string|null;meta_campaign_id:string|null;meta_ad_id:string|null;last_error:string|null;
};
type Draft={headline:string;primaryText:string;description:string;source:string};
const start:Draft={headline:"BROS SELL™ — Sistem Jualan Lebih Tersusun",
 primaryText:"Pelanggan bertanya, tetapi keputusan masih tertangguh? Jualan perlukan proses yang jelas — kenali pembeli, jelaskan nilai tawaran dan lakukan susulan dengan sistem. BROS SELL™ — Closing OS merangkumi buku 36 bab, 12 peta sistem visual dan 13 toolkit XLSX. Harga RM100. Menjelaskan, bukan Memujuk.",
 description:"Lihat kandungan BROS SELL™ — Closing OS sebelum membuat keputusan.",source:"verified-template"};
const money=(n:number|string)=>Number(n).toFixed(2);
async function request(path:string,method:"GET"|"POST",data?:unknown){
 const r=await fetch(path,{method,cache:"no-store",headers:{"Content-Type":"application/json"},
  ...(data?{body:JSON.stringify(data)}:{})});
 const payload=await r.json().catch(()=>({}));
 if(!r.ok)throw new Error(String(payload.error??"Request failed")+" ("+r.status+")");
 return payload;
}
export function CampaignStudio(){
 const [plans,setPlans]=useState<Plan[]>([]);
 const [draft,setDraft]=useState<Draft>(start);
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState("");
 const [error,setError]=useState("");
 const [budgetInputs,setBudgets]=useState<Record<string,string>>({});
 const [phraseInputs,setPhrases]=useState<Record<string,string>>({});
 const [activateInputs,setActivations]=useState<Record<string,string>>({});
 const [confirmAssets,setConfirmAssets]=useState(false);
 const [angle,setAngle]=useState("New and experienced Malaysian business sellers who struggle to handle buying objections.");
 async function loadPlans(){
  try{const d=await request("/api/operator/studio","GET");setPlans(d.plans??[]);}
  catch(e){setError(e instanceof Error?e.message:"Cannot load plans.");}
 }
 useEffect(()=>{void loadPlans();},[]);
 async function generate(){
  setBusy(true);setError("");
  try{
   const out=await request("/api/operator/creative","POST",{angle});
   setDraft(out.draft);
   setMessage(out.aiConfigured&&out.draft.source==="gemini-assisted"?"AI draft created. Review all product claims and brand rules.":"Verified editorial template loaded. Connect a separately authorized Gemini API key later for AI-assisted copy.");
  }catch(e){setError(e instanceof Error?e.message:"Draft provider error.");}
  finally{setBusy(false);}
 }
 async function create(event:FormEvent<HTMLFormElement>){
  event.preventDefault();setBusy(true);setError("");setMessage("");
  try{
   const form=new FormData(event.currentTarget);
   const read=(n:string)=>String(form.get(n)??"").trim();
   const out=await request("/api/operator/studio","POST",{
    name:read("name"),objective:read("objective"),durationDays:Number(read("durationDays")),
    pageId:read("pageId"),imageHash:read("imageHash"),pixelId:read("pixelId"),
    headline:draft.headline,primaryText:draft.primaryText,description:draft.description,
    assetsConfirmed:confirmAssets,
   });
   setMessage("Draft saved as "+out.plan.status+". No Meta request or spend occurred.");
   await loadPlans();
  }catch(e){setError(e instanceof Error?e.message:"Could not create plan.");}
  finally{setBusy(false);}
 }
 async function act(id:string,action:"approve"|"stage"|"activate"|"pause",budget?:number){
  setBusy(true);setError("");setMessage("");
  try{
   const out=await request("/api/operator/studio/"+id,"POST",{
    action,
    ...(action==="approve"?{budget,approvalPhrase:phraseInputs[id]??""}:{}),
    ...(action==="activate"?{activationConfirmation:activateInputs[id]??""}:{})
   });
   setMessage(action.toUpperCase()+" completed: "+(out.status??out.plan?.status??"authorized")+
    ". Review provider and audit before the next step.");
   await loadPlans();
  }catch(e){setError(e instanceof Error?e.message:"Action failed.");await loadPlans();}
  finally{setBusy(false);}
 }
 return <div className="studio-stack">
  <section className="panel">
   <p className="label">01 / PRODUCT-VERIFIED CREATIVE</p>
   <h2>Strategy and copy production</h2>
   <p className="muted">Current BROS SELL™ offer: RM100. No guarantee, testimonials, invented bonuses or regenerated brand logos. AI credentials are optional; the canonical editorial draft works without a provider key.</p>
   <label className="studio-field">Audience / selling-moment angle
    <textarea value={angle} onChange={e=>setAngle(e.target.value)} maxLength={260} rows={2}/>
   </label>
   <button disabled={busy} type="button" onClick={generate}>Generate campaign copy</button>
   <div className="studio-columns">
    <label className="studio-field">Headline<input value={draft.headline} maxLength={255} onChange={e=>setDraft({...draft,headline:e.target.value})}/></label>
    <label className="studio-field">Short description<input value={draft.description} maxLength={500} onChange={e=>setDraft({...draft,description:e.target.value})}/></label>
   </div>
   <label className="studio-field">Primary ad text<textarea rows={5} maxLength={2000} value={draft.primaryText} onChange={e=>setDraft({...draft,primaryText:e.target.value})}/></label>
   <p className="muted">Creative source: {draft.source}. This text must be reviewed before Meta approval.</p>
  </section>

  <section className="panel">
   <p className="label">02 / EDITORIAL APPROVAL & ASSETS</p>
   <h2>Prepare a new campaign</h2>
   <p className="muted">Use an already approved Meta creative image hash and Page ID from BOLEHEJAS SOLUTIONS. No unofficial BROS artwork is generated. New campaigns start PAUSED, and cannot deliver without budget authorization and a separate activation.</p>
   <form className="form studio-form" onSubmit={create}>
    <label>Campaign name<input name="name" required minLength={5} defaultValue={"BROSSELL | Malaysia | Campaign Studio"}/></label>
    <div className="row">
     <label>Objective<select name="objective" defaultValue="TRAFFIC">
      <option value="TRAFFIC">Traffic (clicks)</option><option value="SALES">Sales (verified Purchase pixel)</option>
     </select></label>
     <label>Lifetime duration (days)<input name="durationDays" type="number" min={1} max={30} defaultValue={7} required/></label>
    </div>
    <div className="row">
     <label>Authorized Meta Page ID<input name="pageId" required pattern="[0-9]{6,}" placeholder="Existing approved business Page ID"/></label>
     <label>Existing approved image hash<input name="imageHash" required pattern="[A-Fa-f0-9]{32}" placeholder="32-character Meta image hash"/></label>
    </div>
    <label>Verified Purchase Pixel ID (Sales objective only)<input name="pixelId" pattern="[0-9]{6,}" placeholder="Only if Purchase is verified"/></label>
    <label className="studio-checkbox"><input type="checkbox" checked={confirmAssets} onChange={e=>setConfirmAssets(e.target.checked)}/>
     <span>I verified the copied claims, image ownership, official branding, and authorized Meta account. No unverified outcomes.</span>
    </label>
    <button disabled={busy||!confirmAssets} type="submit">Save audited draft (no spend)</button>
   </form>
  </section>

  <section className="panel">
   <div className="panel-head"><div><p className="label">03 / FINANCIAL CONTROL PLANE</p><h2>Campaign queue</h2></div>
     <button disabled={busy} className="ghost" type="button" onClick={()=>void loadPlans()}>Refresh</button></div>
   {error&&<p className="operator-error" role="alert">{error}</p>}
   {message&&<p className="studio-message" role="status">{message}</p>}
   {plans.length===0&&<p className="muted">No saved campaigns yet. Draft the first reviewed offer above.</p>}
   {plans.map(p=><article key={p.id} className="studio-plan">
    <div className="studio-plan-head"><strong>{p.name}</strong><span className="status">{p.status}</span></div>
    <p className="muted">{p.objective} · {p.duration_days} days · {p.headline}</p>
    <p className="muted">Authorized lifetime cap: RM{money(p.budget_cap_myr)} {p.meta_campaign_id?"· Meta ID "+p.meta_campaign_id:"· Not staged in Meta"}</p>
    {p.last_error&&<p className="operator-error">{p.last_error}</p>}
    {p.status==="DRAFT"&&<div className="studio-approval">
     <p className="muted">Set a finite lifetime cap. The app requires the exact typed authorization below, and one authorized campaign at a time.</p>
     <label className="studio-field">Lifetime budget in MYR<input type="number" min="5" max="10000" step=".01" value={budgetInputs[p.id]??""} onChange={e=>setBudgets({...budgetInputs,[p.id]:e.target.value})}/></label>
     <label className="studio-field">Type: AUTHORIZE RM{money(budgetInputs[p.id]||0)}
      <input autoComplete="off" value={phraseInputs[p.id]??""} onChange={e=>setPhrases({...phraseInputs,[p.id]:e.target.value})}/></label>
     <button disabled={busy||!budgetInputs[p.id]||phraseInputs[p.id]!=="AUTHORIZE RM"+money(budgetInputs[p.id]||0)}
      type="button" onClick={()=>void act(p.id,"approve",Number(budgetInputs[p.id]))}>Authorize this lifetime cap</button>
    </div>}
    {p.status==="APPROVED"&&<div className="studio-action">
      <p className="muted">Approval expires: {p.authorization_expires_at?new Date(p.authorization_expires_at).toLocaleString():"Unknown"}. Staging requires a separately configured Meta write credential and deployment cap.</p>
      <button disabled={busy} type="button" onClick={()=>void act(p.id,"stage")}>Create PAUSED Meta campaign, ad set and ad</button></div>}
    {p.status==="STAGED"&&<div className="studio-action">
      <p className="muted">All Meta objects are PAUSED. To begin real paid delivery, explicitly confirm the authorized maximum.</p>
      <label className="studio-field">Type: ACTIVATE RM{money(p.budget_cap_myr)}
       <input value={activateInputs[p.id]??""} autoComplete="off" onChange={e=>setActivations({...activateInputs,[p.id]:e.target.value})}/></label>
      <button disabled={busy||activateInputs[p.id]!=="ACTIVATE RM"+money(p.budget_cap_myr)}
       type="button" onClick={()=>void act(p.id,"activate")}>Activate authorized campaign</button></div>}
    {p.status==="ACTIVE"&&<div className="studio-action">
      <p className="muted">Campaign delivering within approved Meta lifetime budget. Emergency pause remains available.</p>
      <button disabled={busy} type="button" onClick={()=>void act(p.id,"pause")}>Pause campaign immediately</button>
    </div>}
    {["STAGING","ACTIVATING","PAUSING","FAILED"].includes(p.status)&&<p className="operator-error">
     Reconciliation required. Do not retry a partial Meta request; inspect Meta Ads Manager.</p>}
   </article>)}
  </section>
  <section className="panel"><p className="label">04 / OPERATOR PROTOCOL</p>
   <h2>Controlled autonomy</h2>
   <p className="muted">Planning and analysis do not create spending authority. Each campaign must be authorized against a fixed lifetime budget. Meta credentials, account-level cap and execution switch are kept exclusively in Vercel server settings, never inside this browser. Operator execution logs are saved in the BCI audit table. Automated optimization cannot increase budgets.</p>
  </section>
 </div>;
}
