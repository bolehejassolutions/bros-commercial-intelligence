'use client';
import {useEffect,useState} from 'react';
import {createAuthClient,type VanillaBetterAuthClient} from '@neondatabase/auth';
import {BetterAuthVanillaAdapter,type BetterAuthVanillaAdapterInstance} from '@neondatabase/auth/vanilla/adapters';
import {requestNeonPreviewToken,requestNeonPreviewSession} from '@/lib/bci/neon-preview-client-token';
import {createContentReviewerKey,signContentReviewDecision,SCRIPT_REVIEW_CHECKS,type ContentReviewerKey} from '@/lib/portfolio/content-review-signing';
type Json=Record<string,unknown>;
type Setup={ready:boolean;missing:string[];registeredKeyIds:string[]};
type Pack={title:string;envelope:Json;handoff:Json;images:string[];reviewerSubject:string;setup:Setup};
const email='rasymokh@gmail.com';
const authBase='https://ep-fancy-queen-b30g0cjn.neonauth.c-4.ap-southeast-1.aws.neon.tech/bros_intelligence_dev/auth';
let client:VanillaBetterAuthClient|undefined;
const auth=()=>client??=createAuthClient<BetterAuthVanillaAdapterInstance>(authBase,{
  adapter:BetterAuthVanillaAdapter({fetchOptions:{credentials:'include'}})});
const labels:Record<string,string>={
  VERIFY_EACH_IMAGE_VISUALLY_AND_INDEPENDENTLY:'Saya telah memeriksa setiap imej asal.',
  VERIFY_CAPTION_ALT_TEXT_AND_IMAGE_SEMANTIC_ALIGNMENT:'Kapsyen, penerangan imej dan visual membawa maksud yang sama.',
  VERIFY_CLAIM_SOURCES_AND_BRAND_POLICY:'Dakwaan, sumber dan penggunaan jenama telah disemak.',
  VERIFY_AI_DISCLOSURE_AND_PLATFORM_REQUIREMENTS:'Pendedahan AI dan keperluan platform adalah tepat.',
  VERIFY_CONTENT_SPECIFIC_AUTHENTICATED_APPROVAL:'Keputusan ini khusus untuk pek kandungan yang dipaparkan.',
  VERIFY_PUBLISHER_CHANNEL_CAPABILITY_AND_PERMISSION:'Saluran destinasi dan kebenarannya telah disemak.',
  VERIFY_SCRIPT_SHOTS_MATCH_RENDERED_MEDIA_SEMANTICALLY:'Setiap bahagian skrip sepadan dengan visualnya.',
  VERIFY_RESOURCE_MAPPING_INPUT_ACTION_OUTPUT_AND_PAYOFF:'Contoh, tindakan dan hasil pembelajaran menepati janji pembukaan.',
  VERIFY_SCRIPT_COPY_CLAIMS_RIGHTS_AND_DISCLOSURE:'Skrip dan salinan mematuhi hak penggunaan, dakwaan dan pendedahan.'};
const missingLabels:Record<string,string>={APPROVAL_RUNTIME_NOT_ENABLED:'Aliran kelulusan Preview belum diaktifkan.',
  RESTRICTED_ISSUER_CONNECTION_MISSING:'Sambungan khusus untuk merekod kelulusan belum disediakan.',
  REVIEWER_PUBLIC_KEY_NOT_REGISTERED:'Kunci awam penyemak belum didaftarkan.'};
const scriptLabels:Record<string,string>={openingHook:'Pembukaan',situation:'Situasi',audienceQuestion:'Soalan',explanation:'Penjelasan',audienceAction:'Tindakan',takeaway:'Inti utama'};
const resourceLabels:Record<string,string>={hookPromise:'Janji pembukaan',demonstratedInput:'Situasi contoh',demonstratedAction:'Tindakan',demonstratedOutput:'Hasil contoh',answerLocation:'Lokasi jawapan'};
async function keyStore(mode:'read'|'write',value?:ContentReviewerKey):Promise<ContentReviewerKey|null>{
  return new Promise((resolve,reject)=>{
    const open=indexedDB.open('bros-content-review',1);
    open.onupgradeneeded=()=>open.result.createObjectStore('reviewer');open.onerror=()=>reject(Error());
    open.onsuccess=()=>{
      const db=open.result,tx=db.transaction('reviewer',mode==='write'?'readwrite':'readonly');
      const request=mode==='write'?tx.objectStore('reviewer').put(value,'active'):tx.objectStore('reviewer').get('active');
      let result:ContentReviewerKey|null=null;
      request.onsuccess=()=>{result=mode==='write'?value!:request.result??null;};
      tx.oncomplete=()=>{db.close();resolve(result);};tx.onerror=()=>{db.close();reject(Error());};
    };
  });
}
export default function ContentReview(){
  const [sources,setSources]=useState<{proofEnvelopeId:string;title:string}[]>([]);
  const [pack,setPack]=useState<Pack|null>(null),[key,setKey]=useState<ContentReviewerKey|null>(null);
  const [setup,setSetup]=useState<Setup|null>(null),[checked,setChecked]=useState<string[]>([]);
  const [busy,setBusy]=useState(true),[attempted,setAttempted]=useState(false);
  const [message,setMessage]=useState('Menyemak sesi dan kandungan…');
  const [audit,setAudit]=useState<{approvalId?:string;dispatchIntentId?:string;reservationId?:string}>({});
  async function token(){if(!await requestNeonPreviewSession(auth(),email))throw Error();return requestNeonPreviewToken(auth());}
  async function get(path:string){const jwt=await token();const r=await fetch(path,{headers:{Authorization:'Bearer '+jwt},cache:'no-store',redirect:'error'});
    if(!r.ok||!/no-store/i.test(r.headers.get('cache-control')||''))throw Error();return r.json();}
  useEffect(()=>{
    let active=true;
    Promise.all([get('/api/internal/neon-content-review'),keyStore('read').catch(()=>null)]).then(([data,saved])=>{
      if(!active)return;setSources(data.sources);setSetup(data.setup);setKey(saved);
      setMessage(data.sources.length?'Pilih pek untuk menyemak skrip dan imej asal.':'Belum ada pek kandungan dalam skop ini.');
    }).catch(()=>{if(active)setMessage('Log masuk ke akaun BROS anda untuk membuka kandungan.');})
      .finally(()=>{if(active)setBusy(false);});return ()=>{active=false;};
  },[]);
  async function select(id:string){setBusy(true);setPack(null);setChecked([]);setAttempted(false);setAudit({});
    try{const data=await get('/api/internal/neon-content-review?proof='+encodeURIComponent(id));setPack(data);setSetup(data.setup);
      const previous=localStorage.getItem('bros-content-operation:'+id);
      if(previous){setAudit(JSON.parse(previous));setAttempted(true);
        setMessage('Pek ini mempunyai rujukan keputusan terdahulu. Semak rekod tersebut sebelum menghantar keputusan baharu.');}
      else setMessage('Pek ini masih draf. Semak semua imej, skrip dan destinasi sebelum membuat keputusan.');}
    catch{setMessage('Pek tidak dapat dibuka. Semak sesi anda dan cuba lagi.');}finally{setBusy(false);}}
  async function makeKey(){setBusy(true);try{const created=await createContentReviewerKey();await keyStore('write',created);setKey(created);
    setMessage('Kunci penyemak disimpan dalam pelayar ini. Daftarkan kunci awam sebelum merekod kelulusan.');}
    catch{setMessage('Pelayar ini tidak dapat menyimpan kunci Ed25519. Gunakan pelayar yang menyokong Web Crypto dan IndexedDB.');}finally{setBusy(false);}}
  function downloadPublicKey(){if(!key)return;const blob=new Blob([JSON.stringify({keyId:key.keyId,publicKeyPem:key.publicKeyPem},null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='BROS_CONTENT_REVIEW_PUBLIC_KEY.json';a.click();URL.revokeObjectURL(url);}
  const required=pack?[...(pack.handoff.requiredHumanChecks as string[]),...SCRIPT_REVIEW_CHECKS]:[];
  const canApprove=!!pack&&!!key&&setup?.ready===true&&setup.registeredKeyIds.includes(key.keyId)&&
    required.length===9&&required.every(x=>checked.includes(x))&&!busy&&!attempted;
  async function approve(){if(!canApprove||!pack||!key)return;setBusy(true);setAttempted(true);setMessage('Merekod keputusan anda…');
    try{
      const receipt=await signContentReviewDecision(key,pack.envelope,pack.handoff,pack.reviewerSubject,checked);
      const dispatch=receipt.dispatch.payload;setAudit({dispatchIntentId:String(dispatch.dispatchIntentId)});
      // Persist the non-secret reference BEFORE any potentially committing call.
      // A refresh or lost response cannot silently submit a new dispatch intent.
      localStorage.setItem('bros-content-operation:'+String(pack.envelope.proofEnvelopeId),
        JSON.stringify({dispatchIntentId:String(dispatch.dispatchIntentId)}));
      const response=await fetch('/api/internal/neon-content-approval',{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',
        headers:{Authorization:'Bearer '+await token(),'Content-Type':'application/json'},body:JSON.stringify({proofEnvelopeId:pack.envelope.proofEnvelopeId,receipt})});
      if(!response.ok)throw Error();const issued=await response.json();
      if(issued.status!=='BCI_CONTENT_V3_APPROVAL_COMMITTED'||issued.committedReadback!==true||issued.providerSent!==false||issued.executionAllowed!==false)throw Error();
      setAudit({dispatchIntentId:String(dispatch.dispatchIntentId),approvalId:issued.approvalId});
      localStorage.setItem('bros-content-operation:'+String(pack.envelope.proofEnvelopeId),
        JSON.stringify({dispatchIntentId:String(dispatch.dispatchIntentId),approvalId:issued.approvalId}));
      setMessage('Kelulusan direkodkan. Mengesahkan tempahan kandungan…');
      const reserve=await fetch('/api/internal/neon-content-reservation',{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',
        headers:{Authorization:'Bearer '+await token(),'Content-Type':'application/json'},
        body:JSON.stringify({dispatchIntentId:dispatch.dispatchIntentId,approvalId:issued.approvalId,bindingSha256:dispatch.bindingSha256})});
      if(!reserve.ok){setMessage('Kelulusan direkodkan; tempahan belum dapat disahkan. Gunakan rujukan di bawah untuk semakan.');return;}
      const reserved=await reserve.json();
      if(reserved.status==='reserved'&&reserved.postCommitReadback===true&&reserved.providerSent===false&&reserved.executionAllowed===false){
        setAudit({dispatchIntentId:String(dispatch.dispatchIntentId),approvalId:issued.approvalId,reservationId:reserved.reservationId});
        localStorage.setItem('bros-content-operation:'+String(pack.envelope.proofEnvelopeId),
          JSON.stringify({dispatchIntentId:String(dispatch.dispatchIntentId),approvalId:issued.approvalId,reservationId:reserved.reservationId}));
        setMessage('Kelulusan dan tempahan disahkan. Kandungan belum dihantar ke platform.');
      }else setMessage('Kelulusan direkodkan; tempahan memerlukan semakan. Kandungan belum dihantar.');
    }catch{setMessage('Keputusan belum dapat disahkan. Elakkan menghantar semula; semak rujukan operasi di bawah dahulu.');}
    finally{setBusy(false);}
  }
  const script=pack?.envelope.script as Json|undefined,copy=pack?.envelope.copy as Json|undefined;
  return <main className='review'><header><a href='/internal/neon-preview'>← Ruang kerja BROS</a><p className='eyebrow'>BROS CONTENT</p>
    <h1>Semak sebelum terbit</h1><p>Skrip, salinan dan imej asal dalam satu pek.</p></header>
    <p role='status' className='status'>{message}</p>
    <nav aria-label='Pek kandungan'>{sources.map(x=><button key={x.proofEnvelopeId} onClick={()=>select(x.proofEnvelopeId)} disabled={busy}>{x.title}</button>)}</nav>
    {!sources.length&&<a href='/internal/neon-preview'>Log masuk ke BROS</a>}
    {pack&&<><h2>{pack.title}</h2><span className='badge'>DRAF · BELUM DILULUSKAN UNTUK TERBIT</span>
      <section><h2>Skrip penuh</h2><dl>{Object.entries(script||{}).filter(([k])=>!['scriptId','revisionId','shots'].includes(k)).map(([k,v])=>
        <div key={k}><dt>{scriptLabels[k]||k}</dt><dd>{String(v)}</dd></div>)}</dl></section>
      <div className='images'>{pack.images.map((src,i)=><figure key={i}><img src={src} alt={String((copy?.altTexts as string[])?.[i]||'Imej asal '+(i+1))}/>
        <figcaption>Imej {i+1} · {String((script?.shots as string[])?.[i])}</figcaption></figure>)}</div>
      <section><h2>Kapsyen</h2><p className='caption'>{String(copy?.caption)}</p><h3>Janji dan tindakan pembelajaran</h3>
        <dl>{Object.entries(pack.envelope.resourceMapping as Json).filter(([k])=>k!=='resourceId').map(([k,v])=><div key={k}>
          <dt>{resourceLabels[k]||k}</dt><dd>{String(v)}</dd></div>)}</dl>
        <h3>Destinasi</h3><p>{String((pack.envelope.destination as Json).channelService)} · {String((pack.envelope.destination as Json).channelId)}</p></section>
      <section><h2>Keputusan penyemak</h2><p>Tandakan hanya perkara yang anda sendiri telah periksa.</p>
        {required.map(check=><label key={check}><input type='checkbox' disabled={attempted||busy} checked={checked.includes(check)}
          onChange={e=>setChecked(e.target.checked?[...checked,check]:checked.filter(x=>x!==check))}/>{labels[check]||check}</label>)}
        <button className='primary' onClick={approve} disabled={!canApprove}>Rekod kelulusan dan tempahan</button>
        <p className='muted'>Penghantaran ke platform memerlukan aliran penerbitan yang dibenarkan.</p></section></>}
    <details><summary>Persediaan penyemak dan rujukan</summary>
      {setup&&!setup.ready&&<ul>{setup.missing.map(x=><li key={x}>{missingLabels[x]||x}</li>)}</ul>}
      {!key?<button onClick={makeKey} disabled={busy}>Sediakan kunci penyemak pada pelayar ini</button>:<><p>Kunci awam: <code>{key.keyId}</code></p>
        <p>Kunci peribadi kekal dalam pelayar ini. Kunci awam perlu didaftarkan oleh pentadbir.</p><button onClick={downloadPublicKey}>Muat turun kunci awam</button>
        {!setup?.registeredKeyIds.includes(key.keyId)&&<p>Kunci ini belum didaftarkan untuk kelulusan.</p>}</>}
      {pack&&<p>ID pek: <code>{String(pack.envelope.proofEnvelopeId)}</code></p>}
      {Object.entries(audit).map(([k,v])=><p key={k}>{k}: <code>{v}</code></p>)}</details>
    <style jsx>{` .review{max-width:1040px;margin:0 auto;padding:32px 20px 80px;font:16px/1.6 system-ui;color:#e7eaf1}header{margin:20px 0 28px}.eyebrow{letter-spacing:.18em;color:#e8c56a;font-size:13px}h1{font-size:clamp(30px,5vw,48px);line-height:1.2;margin:8px 0}h2{margin-top:0;font-size:24px}a{color:#e8c56a}section,details,.status{padding:24px;border:1px solid #34445d;border-radius:16px;background:#142035;margin:22px 0}.status{border-left:4px solid #e8c56a}.images{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}figure{margin:0}img{width:100%;height:auto;border-radius:12px}figcaption{font-size:14px;margin:8px 0 24px;color:#b4c0d2}dl>div{margin-bottom:18px}dt{color:#e8c56a;font-weight:600}dd{margin:3px 0 0}.caption{white-space:pre-wrap}.badge{display:inline-block;border:1px solid #8d7543;color:#eed293;border-radius:8px;padding:6px 10px;font-size:12px}button{font:inherit;background:#263951;color:#eef1f6;border:1px solid #57708c;border-radius:10px;padding:12px 18px;margin:5px 8px 5px 0;cursor:pointer}button:disabled{opacity:.45;cursor:default}.primary{background:#e8c56a;color:#101827;font-weight:700;margin-top:22px}label{display:flex;align-items:flex-start;gap:12px;margin:15px 0}input{margin-top:7px;accent-color:#e8c56a;flex:none}.muted{font-size:14px;color:#b4c0d2}code{overflow-wrap:anywhere}summary{cursor:pointer;color:#e8c56a}@media(max-width:650px){.images{grid-template-columns:1fr}section,details,.status{padding:18px}.review{padding:20px 15px 60px}} `}</style>
  </main>;
}
