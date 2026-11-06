"use client";

import { useEffect, useState, type FormEvent } from "react";

type Result = Readonly<{
  lineageKey: string;trackedLandingUrl: string;status: string;
  contentApprovalVerified: false;providerSentVerified: false;
  landingReceiptVerified: false;paidOrderVerified: false;
  attributedRevenueMYR: null;executionAllowed: false;
}>;

/** Internal operator bridge. It prepares a labelled link but never publishes. */
export default function PortfolioLineagePanel({
  signedIn,getToken,onSessionExpired,
}:{
  signedIn:boolean;getToken:()=>Promise<string>;onSessionExpired:()=>void;
}) {
  const [plan,setPlan]=useState("");
  const [creative,setCreative]=useState("");
  const [channel,setChannel]=useState("facebook");
  const [campaign,setCampaign]=useState("bros_sell_organic_v1");
  const [destination,setDestination]=useState("https://bros.bolehejas.com/");
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState("");
  const [result,setResult]=useState<Result|null>(null);
  // CONTENT handoff fragment carries only a plan digest, copy digest and channel.
  // It never grants approval or authorization; authenticated DEMAND generates a
  // non-executing candidate after verifying joint tenant/product membership.
  useEffect(()=>{
    if(!window.location.hash)return;
    const p=new URLSearchParams(window.location.hash.slice(1));
    const names=[...p.keys()];
    if(names.length!==3 || names.some(x=>!["contentPlanId","creativeSha256","channel"].includes(x)) ||
       !["contentPlanId","creativeSha256","channel"].every(x=>p.getAll(x).length===1))return;
    const planId=p.get("contentPlanId")??"";
    const creativeId=p.get("creativeSha256")??"";
    const destination=p.get("channel")??"";
    if(!/^content-plan-[a-f0-9]{64}$/.test(planId)||
       !/^[a-f0-9]{64}$/.test(creativeId)||
       !["facebook","instagram","tiktok"].includes(destination))return;
    setPlan(planId);setCreative(creativeId);setChannel(destination);
    setResult(null);
    setNotice("CONTENT reference received. It is not proof of publication or sale. Confirm the campaign details before preparing the link.");
    window.history.replaceState(window.history.state,"",window.location.pathname+window.location.search);
  },[]);

  function invalidate(){setResult(null);setNotice("");}
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(!signedIn||busy)return;
    setBusy(true);setResult(null);setNotice("Validating the scoped cross-product link…");
    try{
      const jwt=await getToken();
      const res=await fetch("/api/internal/portfolio-lineage",{
        method:"POST",cache:"no-store",credentials:"same-origin",redirect:"error",
        headers:{"Content-Type":"application/json",Authorization:"Bearer "+jwt},
        body:JSON.stringify({
          contentPlanId:plan.trim(),creativeSha256:creative.trim(),
          channel,campaignKey:campaign.trim(),landingUrl:destination.trim(),
        }),
      });
      if(res.status===401||res.status===403){onSessionExpired();throw Error("Authentication or scope denied.");}
      const body=await res.json() as Result;
      if(!res.ok||body.status!=="LINK_SPEC_NOT_PUBLISHED"||
        body.executionAllowed!==false||body.paidOrderVerified!==false)
        throw Error("Tracking link could not be verified. Check the CONTENT plan and campaign fields.");
      setResult(body);
      setNotice("Tracking link prepared. CONTENT must approve and publish it; SELL must independently preserve first-party receipts. This is not an attributed sale.");
    }catch(e){
      setNotice(e instanceof Error?e.message:"Unable to prepare tracking link.");
    }finally{setBusy(false);}
  }
  return <section className="auth-form" aria-labelledby="portfolio-lineage-title"
    style={{border:"1px solid #52647a",borderRadius:12,padding:"1.2rem",marginTop:"2rem"}}>
    <h2 id="portfolio-lineage-title">CONTENT → DEMAND → SELL</h2>
    <p className="sub">Create a shared attribution label for one actual CONTENT plan.
      This never approves content, publishes a post, modifies a Meta campaign or verifies a paid order.</p>
    <form onSubmit={submit} className="auth-form">
      <label>CONTENT plan identifier
        <input required value={plan} onChange={e=>{setPlan(e.target.value);invalidate();}}
          pattern="content-plan-[a-f0-9]{64}" placeholder="content-plan-… (actual approved plan)" />
      </label>
      <label>Exact approved creative SHA256
        <input required value={creative} onChange={e=>{setCreative(e.target.value);invalidate();}}
          pattern="[a-f0-9]{64}" placeholder="64-character media/version digest" />
      </label>
      <label>Content channel
        <select value={channel} onChange={e=>{setChannel(e.target.value);invalidate();}}>
          <option value="facebook">Facebook</option>
          <option value="instagram">Instagram</option>
          <option value="tiktok">TikTok</option>
        </select>
      </label>
      <label>Demand campaign tag
        <input required value={campaign} onChange={e=>{setCampaign(e.target.value);invalidate();}}
          pattern="[a-z][a-z0-9_]{2,63}" maxLength={64}/>
      </label>
      <label>SELL landing destination
        <input type="url" required value={destination} onChange={e=>{setDestination(e.target.value);invalidate();}}/>
      </label>
      <button type="submit" disabled={!signedIn||busy}>
        Prepare tracking link (no publication)
      </button>
    </form>
    <p role="status" className="sub">{!signedIn?"Sign in to access the scoped handoff.":notice}</p>
    {result&&<div className="auth-form">
      <label>Proposed landing link
        <input readOnly value={result.trackedLandingUrl}/>
      </label>
      <button type="button" onClick={()=>void navigator.clipboard.writeText(result.trackedLandingUrl).then(
        ()=>setNotice("Link copied. Publication and conversion attribution remain unverified."),
        ()=>setNotice("Browser copy is unavailable; select the link above.")
      )}>Copy proposed link</button>
      <p className="sub">Status: {result.status}. CONTENT approval, Buffer SENT,
        first-party checkout linkage, HitPay paid order and BCI evidence are separate acceptance gates.</p>
    </div>}
  </section>;
}
