'use client';
import {useState} from 'react';
type Draft={name:string;budgetMinor:number;durationDays:number;startTime:string;landingUrl:string;
  primaryText:string;headline:string;description:string;imageHash:string};
type Preview={plan:Draft&{planSha256:string;endTime:string};blockers:string[];providerVerified:boolean;canCreate:boolean;existingSteps:number};
const endpoint='/api/internal/demand-meta-campaigns';
const blockers:Record<string,string>={PAUSED_CREATION_NOT_ENABLED:'Paused campaign creation has not been enabled for this Preview.',
  CREATOR_LEDGER_NOT_REVIEWED:'The scoped campaign journal needs its development setup review.',
  PAUSED_PLAN_OWNER_APPROVAL_REQUIRED:'The owner must approve this exact campaign plan before any new Meta creation.',
  PAUSED_CREATIVE_EVIDENCE_REQUIRED:'The plan needs approved CONTENT copy and original media linked to the selected Meta image.',
  META_MANAGEMENT_OR_IMAGE_LIBRARY_UNVERIFIED:'The current Meta connection or image library could not be verified.',
  META_ACCOUNT_IMAGE_OR_IDENTITIES_UNVERIFIED:'Meta could not confirm the account, selected image or Malaysia identity mapping.',
  LEDGER_UNAVAILABLE_OR_RECONCILIATION_REQUIRED:'The campaign journal is unavailable or an earlier operation needs reconciliation.'};
export default function PausedCampaignCreator({getToken,signedIn,onSessionExpired}:{getToken:()=>Promise<string>;signedIn:boolean;onSessionExpired:()=>void}){
  const [name,setName]=useState(''),[budget,setBudget]=useState('140.00'),[days,setDays]=useState(7);
  const [start,setStart]=useState(new Date(Date.now()+9*3600000).toISOString().slice(0,16));
  const [url,setUrl]=useState('https://bros.bolehejas.com/'),[text,setText]=useState(''),[headline,setHeadline]=useState(''),[description,setDescription]=useState('');
  const [image,setImage]=useState(''),[images,setImages]=useState<{hash:string;name:string}[]>([]);
  const [busy,setBusy]=useState(false),[approved,setApproved]=useState(false),[preview,setPreview]=useState<Preview|null>(null);
  const [notice,setNotice]=useState('Review a campaign plan or reconcile previously recorded PAUSED objects.');
  const [setup,setSetup]=useState<string[]>([]),[result,setResult]=useState<Record<string,string>|null>(null),[uncertain,setUncertain]=useState(false);
  const [recovery,setRecovery]=useState<unknown>(null);
  const [retryReceipt,setRetryReceipt]=useState<string|null>(null),[retryApproved,setRetryApproved]=useState(false);
  async function request(payload?:unknown){
    const jwt=await getToken();const r=await fetch(endpoint,{method:payload?'POST':'GET',cache:'no-store',credentials:'same-origin',redirect:'error',
      headers:{Authorization:'Bearer '+jwt,...(payload?{'Content-Type':'application/json'}:{})},
      body:payload?JSON.stringify(payload):undefined,signal:AbortSignal.timeout(55000)});
    if(r.status===401||r.status===403){onSessionExpired();throw Error('Sign in again to continue.');}
    if(!r.headers.get('cache-control')?.includes('no-store'))throw Error('Response could not be verified.');
    const data=await r.json();if(!r.ok){if(data.reconcileRequired)setUncertain(true);throw Error(data.reconcileRequired?
      'An operation may have committed. Reconcile the saved plan reference before retrying.':'Action blocked. Check the form, connection and setup.');}return data;
  }
  function changed(){setPreview(null);setApproved(false);setResult(null);setUncertain(false);setRetryReceipt(null);setRetryApproved(false);}
  function draft():Draft{
    const m=budget.trim().match(/^(\d+)(?:\.(\d{1,2}))?$/);if(!m)throw Error('Enter a MYR amount with up to two decimal places.');
    const minor=Number(m[1])*100+Number((m[2]||'').padEnd(2,'0'));
    return {name:name.trim(),budgetMinor:minor,durationDays:days,startTime:new Date(start+':00+08:00').toISOString(),
      landingUrl:url.trim(),primaryText:text.trim(),headline:headline.trim(),description:description.trim(),imageHash:image};
  }
  async function connect(){if(busy)return;setBusy(true);try{const data=await request();
    if(data.source!=='BROS_DEMAND_PAUSED_CREATOR'||data.activationAvailable!==false)throw Error('Unexpected creator response.');
    setImages(data.images?.items||[]);setSetup(data.missing);
    const ledger=await request({action:'verify_ledger'});
    setNotice(data.connectionVerified&&ledger.status==='VERIFIED_PASS'&&ledger.probeRolledBack===true?
      'Meta connection, image library and scoped campaign journal verified. Complete the campaign below.':'Setup could not be fully confirmed.');}
    catch(e){setNotice(e instanceof Error?e.message:'Connection unavailable.');}finally{setBusy(false);}}
  async function review(){if(busy)return;setBusy(true);setApproved(false);setResult(null);
    try{const data=await request({action:'preview',draft:draft()});
      if(data.source!=='BROS_DEMAND_PAUSED_CREATOR'||data.activationAvailable!==false)throw Error('Unexpected review response.');
      setPreview(data);setUncertain(!!localStorage.getItem('bros-demand-paused:'+data.plan.planSha256));
      setNotice(data.canCreate?'Exact campaign plan checked. Review the details before creating it.':'Review prepared; resolve the requirements shown below.');}
    catch(e){setPreview(null);setNotice(e instanceof Error?e.message:'Review unavailable.');}finally{setBusy(false);}}
  async function create(){if(!preview?.canCreate||!approved||busy||uncertain)return;
    const frozen=draft(),hash=preview.plan.planSha256;setBusy(true);setNotice('Creating reviewed campaign objects in PAUSED status…');
    try{
      localStorage.setItem('bros-demand-paused:'+hash,JSON.stringify({planSha256:hash,state:'submitted'}));
      for(let i=0;i<4;i++){
        const data=await request({action:'create_paused',draft:frozen,planSha256:hash,authorization:'CREATE_PAUSED_ONLY'});
        if(data.source!=='BROS_DEMAND_PAUSED_CREATOR'||data.planSha256!==hash||data.providerReadbackVerified!==true||
           data.committedReadback!==true||data.activationAvailable!==false||data.spendAuthorized!==false)throw Error('Result unconfirmed; reconcile the saved plan.');
        setResult(data.objects);localStorage.setItem('bros-demand-paused:'+hash,JSON.stringify(data));
        if(data.status==='CREATED_PAUSED_VERIFIED'){setNotice('All four objects verified. The campaign, ad set and ad are PAUSED.');setUncertain(true);return;}
        if(data.status!=='CREATING_PAUSED')throw Error('Unexpected state; reconcile before retrying.');
        setNotice('PAUSED creation: '+data.completedSteps+' of 4 steps confirmed.');
      }
      throw Error('Creation did not complete. Reconcile the saved plan before retrying.');
    }catch(e){setUncertain(true);setNotice(e instanceof Error?e.message:'Result unconfirmed. Reconcile before retrying.');}
    finally{setBusy(false);}
  }
  async function reconcile(){if(!preview||busy)return;setBusy(true);setRecovery(null);
    try{const data=await request({action:'reconcile',draft:draft(),planSha256:preview.plan.planSha256,authorization:'RECONCILE_PAUSED_ONLY'});
      if(data.source!=='BROS_DEMAND_PAUSED_CREATOR'||data.planSha256!==preview.plan.planSha256||data.activationAvailable!==false||data.spendAuthorized!==false)throw Error('Recovery response unverified.');
      setRecovery(data.discovery||null);
      setRetryReceipt(data.recoveryReceipt||null);setRetryApproved(false);
      if(data.status==='RECOVERY_HELD'){setUncertain(true);setNotice(data.discovery.validation?.userTitle||('Recovery held: '+data.discovery.status+'. No creation or confirmation was performed.'));return;}
      if(!data.providerReadbackVerified||!data.committedReadback||
         !['CREATED_PAUSED_VERIFIED','RECOVERED_PAUSED'].includes(data.status))throw Error('Recovery readback unverified.');
      const complete=data.status==='CREATED_PAUSED_VERIFIED';
      const canContinue=!complete&&data.canContinue===true;
      const continuationBlocked=!complete&&!canContinue;
      setResult(data.objects);setUncertain(complete);
      setPreview({...preview,canCreate:canContinue,blockers:continuationBlocked?preview.blockers:[]});
      setApproved(false);
      localStorage.setItem('bros-demand-paused:'+preview.plan.planSha256,JSON.stringify(data));
      setNotice(complete?'All four recorded objects verified. The campaign, ad set and ad are PAUSED.':
        continuationBlocked?'Recorded steps checked. Any remaining creation requires exact owner approval and verified creative evidence.':
        'Recorded steps checked. Review the same plan to continue the remaining stages.');
    }catch(e){setUncertain(true);setNotice(e instanceof Error?e.message:'Recovery unverified.');}finally{setBusy(false);}}
  async function retryCreative(){if(!preview||!retryReceipt||!retryApproved||busy)return;setBusy(true);
    try{const data=await request({action:'retry_creative',draft:draft(),planSha256:preview.plan.planSha256,
      recoveryReceipt:retryReceipt,authorization:'RETRY_RECONCILED_PAUSED_CREATIVE'});
      if(data.source!=='BROS_DEMAND_PAUSED_CREATOR'||data.planSha256!==preview.plan.planSha256||data.activationAvailable!==false||data.spendAuthorized!==false)throw Error('Retry result unverified.');
      setRecovery(data.discovery||null);
      if(data.status==='RECOVERY_HELD'){setNotice(data.discovery.validation?.userTitle||'Retry held. Meta validation must pass and no matching creative may exist.');return;}
      if(!data.providerReadbackVerified||!data.committedReadback)throw Error('Retry readback unverified.');
      setResult(data.objects);setUncertain(!data.canContinue);setPreview({...preview,canCreate:data.canContinue,blockers:[]});
      setRetryReceipt(null);setRetryApproved(false);setApproved(false);setNotice('Recovery creative verified. Continue the same reviewed plan to finish the remaining ad.');
    }catch(e){setUncertain(true);setNotice(e instanceof Error?e.message:'Retry outcome unverified; reconcile before continuing.');}finally{setBusy(false);}}
  return <section className='auth-form' aria-labelledby='paused-creator-title' style={{border:'1px solid #52647a',padding:'1.2rem',borderRadius:12,marginBottom:'2rem'}}>
    <h3 id='paused-creator-title'>Review a PAUSED campaign plan</h3><p>Malaysia · ages 21–45 · Facebook and Instagram feeds · Website Purchase · RM140 lifetime plan ceiling.</p>
    <p role='status'>{notice}</p><button type='button' disabled={!signedIn||busy} onClick={connect}>Check connection and load images</button>
    {setup.length>0&&<ul>{setup.map(x=><li key={x}>{blockers[x]||'A setup requirement remains unverified.'}</li>)}</ul>}
    <label>Campaign name<input value={name} maxLength={100} disabled={busy} onChange={e=>{changed();setName(e.target.value);}}/></label>
    <label>Lifetime budget (MYR)<input value={budget} inputMode='decimal' disabled={busy} onChange={e=>{changed();setBudget(e.target.value);}}/></label>
    <label>Start time (Malaysia)<input type='datetime-local' value={start} disabled={busy} onChange={e=>{changed();setStart(e.target.value);}}/></label>
    <label>Duration<select value={days} disabled={busy} onChange={e=>{changed();setDays(Number(e.target.value));}}>{[1,2,3,4,5,6,7].map(d=><option key={d} value={d}>{d} days</option>)}</select></label>
    <label>Landing page<input type='url' value={url} disabled={busy} onChange={e=>{changed();setUrl(e.target.value);}}/></label>
    <label>Existing Meta image<select value={image} disabled={busy} onChange={e=>{changed();setImage(e.target.value);}}><option value=''>Choose an image from this ad account</option>
      {images.map(x=><option key={x.hash} value={x.hash}>{x.name}</option>)}</select></label>
    <label>Primary text<textarea value={text} maxLength={4000} rows={6} disabled={busy} onChange={e=>{changed();setText(e.target.value);}}/></label>
    <label>Headline<input value={headline} maxLength={120} disabled={busy} onChange={e=>{changed();setHeadline(e.target.value);}}/></label>
    <label>Description<input value={description} maxLength={200} disabled={busy} onChange={e=>{changed();setDescription(e.target.value);}}/></label>
    <button type='button' disabled={!signedIn||busy||!image||!name||!text||!headline} onClick={review}>Review exact campaign plan</button>
    {preview&&<div><h4>Reviewed plan</h4><p>{preview.plan.name} · RM{(preview.plan.budgetMinor/100).toFixed(2)} lifetime · {preview.plan.durationDays} days</p>
      <p>Start: {new Date(preview.plan.startTime).toLocaleString('en-MY',{timeZone:'Asia/Kuala_Lumpur'})} MYT</p><p>Destination: {preview.plan.landingUrl}</p>
      {preview.blockers.length>0&&<ul>{preview.blockers.map(x=><li key={x}>{blockers[x]||'A setup requirement remains unverified.'}</li>)}</ul>}
      {uncertain&&<p>A submission already exists for this plan. Reconcile its recorded objects before submitting another operation.</p>}
      <button type='button' disabled={busy||!signedIn} onClick={reconcile}>Reconcile existing PAUSED objects</button>
      {recovery!==null&&<details open><summary>Recovery readback checks</summary><pre>{JSON.stringify(recovery,null,2)}</pre></details>}
      {retryReceipt&&<div><p>No exact matching creative was found. One guarded retry is available only after fresh Meta validation passes. It reuses this campaign and ad set and remains PAUSED.</p>
        <label><input type='checkbox' checked={retryApproved} disabled={busy} onChange={e=>setRetryApproved(e.target.checked)}/>I approve one reconciled creative retry in PAUSED status.</label>
        <button type='button' disabled={busy||!retryApproved||!signedIn} onClick={retryCreative}>Retry reconciled creative — PAUSED</button></div>}
      <label><input type='checkbox' checked={approved} disabled={busy||uncertain} onChange={e=>setApproved(e.target.checked)}/>I approve creating this reviewed campaign in PAUSED status.</label>
      <button type='button' disabled={!preview.canCreate||!approved||busy||uncertain} onClick={create}>Create reviewed campaign — PAUSED</button>
      <details><summary>Plan and operation references</summary><p>Plan: <code>{preview.plan.planSha256}</code></p>{result&&Object.entries(result).map(([kind,id])=><p key={kind}>{kind}: {id}</p>)}</details>
    </div>}
  </section>;
}
