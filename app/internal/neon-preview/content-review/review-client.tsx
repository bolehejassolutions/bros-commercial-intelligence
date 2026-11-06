'use client';
import {useEffect,useState} from 'react';
import {createAuthClient,type VanillaBetterAuthClient} from '@neondatabase/auth';
import {BetterAuthVanillaAdapter,type BetterAuthVanillaAdapterInstance} from '@neondatabase/auth/vanilla/adapters';
import {requestNeonPreviewToken,requestNeonPreviewSession} from '@/lib/bci/neon-preview-client-token';
import {createContentReviewerKey,signContentReviewDecision,SCRIPT_REVIEW_CHECKS,type ContentReviewerKey} from '@/lib/portfolio/content-review-signing';
import {prepareContentDemandBridgeUrl} from '@/lib/portfolio/content-demand-bridge-link';
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
  const [publicKeyCopyMessage,setPublicKeyCopyMessage]=useState('');
  const [activeFrame,setActiveFrame]=useState(0);
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
  async function select(id:string){setBusy(true);setPack(null);setActiveFrame(0);setChecked([]);setAttempted(false);setAudit({});
    try{const data=await get('/api/internal/neon-content-review?proof='+encodeURIComponent(id));setPack(data);setSetup(data.setup);
      const previous=localStorage.getItem('bros-content-operation:'+id);
      if(previous){setAudit(JSON.parse(previous));setAttempted(true);
        setMessage('Pek ini mempunyai rujukan keputusan terdahulu. Semak rekod tersebut sebelum menghantar keputusan baharu.');}
      else setMessage('Pek ini masih draf. Semak semua imej, skrip dan destinasi sebelum membuat keputusan.');}
    catch{setMessage('Pek tidak dapat dibuka. Semak sesi anda dan cuba lagi.');}finally{setBusy(false);}}
  async function makeKey(){setBusy(true);try{const created=await createContentReviewerKey();await keyStore('write',created);setKey(created);
    setMessage('Kunci penyemak disimpan dalam pelayar ini. Daftarkan kunci awam sebelum merekod kelulusan.');}
    catch{setMessage('Pelayar ini tidak dapat menyimpan kunci Ed25519. Gunakan pelayar yang menyokong Web Crypto dan IndexedDB.');}finally{setBusy(false);}}
  async function copyPublicKeyConfig(){
    if(!key)return;
    try{
      // Only this Ed25519 PUBLIC key is copied; the private key is never exported.
      await navigator.clipboard.writeText(JSON.stringify({[key.keyId]:key.publicKeyPem}));
      setPublicKeyCopyMessage('Konfigurasi kunci awam disalin. Tambahkan sebagai pemboleh ubah Preview untuk cabang BCI yang betul.');
    }catch{
      setPublicKeyCopyMessage('Salinan tidak dibenarkan oleh pelayar ini. Gunakan fail JSON kunci awam yang telah dimuat turun.');
    }
  }
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

  const script=pack?.envelope.script as Json|undefined;
  const copy=pack?.envelope.copy as Json|undefined;
  const resource=pack?.envelope.resourceMapping as Json|undefined;
  const destination=pack?.envelope.destination as Json|undefined;
  const selectedFrame=pack?Math.min(activeFrame,Math.max(0,pack.images.length-1)):0;
  const completedChecks=required.filter(x=>checked.includes(x)).length;
  const handoffUrl=(()=>{
    if(!pack||!audit.reservationId)return null;
    try{return prepareContentDemandBridgeUrl({
      planId:String(pack.envelope.planId),
      proofEnvelopeId:String(pack.envelope.proofEnvelopeId),
      channelService:String(destination?.channelService),
    });}catch{return null;}
  })();
  return <main className="content-studio">
    <div className="studio-layout">
      <aside className="studio-rail" aria-label="Navigasi BROS CONTENT">
        <a className="brand" href="/internal/neon-preview" aria-label="Ruang kerja BROS">
          <span className="brand-mark" aria-hidden="true">B</span>
          <span><span className="brand-name">BROS CONTENT</span><span className="brand-sub">INTERNAL WORKSPACE</span></span>
        </a>
        <div><p className="rail-label">RUANG KERJA</p>
          <nav className="rail-nav" aria-label="Bahagian semakan">
            <a className="current" href="#queue">Pek kandungan</a>
            {pack&&<><a href="#preview">Pratonton visual</a><a href="#review">Semakan &amp; kelulusan</a></>}
            <a href="#technical">Rujukan teknikal</a>
          </nav>
        </div>
        <p className="rail-foot"><span className="status-dot" aria-hidden="true"/>Ruang kerja dalaman<br/>Akses terhad dan disahkan</p>
      </aside>
      <div className="studio-body">
        <div className="top-row">
          <div className="breadcrumb">BROS / CONTENT / <strong>Creative Review</strong></div>
          <span className="top-pill">INTERNAL PREVIEW · TIDAK DITERBITKAN</span>
        </div>
        <header className="heading-block">
          <p className="eyebrow">CREATIVE REVIEW / 01</p>
          <h1>Kandungan yang jelas.<br/>Semakan yang teratur.</h1>
          <p className="lede">Semak visual, skrip, kapsyen dan destinasi dalam satu ruang. Ini aliran semakan editorial dalaman, bukan sistem penjanaan visual AI komersial yang telah disahkan.</p>
        </header>
        <p role="status" aria-live="polite" className="notice">{message}</p>
        <section id="queue" aria-labelledby="queue-heading">
          <div className="queue-header">
            <div><p className="eyebrow">REVIEW QUEUE</p><h2 id="queue-heading">Pek kandungan</h2></div>
            <span className="mini-note">{sources.length} pek tersedia</span>
          </div>
          {sources.length?<nav className="queue-list" aria-label="Pilih pek kandungan">
            {sources.map(item=><button type="button" key={item.proofEnvelopeId}
              className={'queue-item '+(pack?.envelope.proofEnvelopeId===item.proofEnvelopeId?'selected':'')}
              onClick={()=>void select(item.proofEnvelopeId)} disabled={busy}>
              <span className="queue-icon" aria-hidden="true">▤</span><span>{item.title}</span>
            </button>)}
          </nav>:<div className="queue-empty">{busy?'Memuatkan pek…':'Tiada pek dapat dipaparkan untuk sesi ini.'} <a href="/internal/neon-preview">Kembali ke ruang kerja BROS</a>.</div>}
        </section>
        {pack&&<section id="preview" aria-labelledby="project-heading">
          <div className="project-head">
            <div><p className="eyebrow">CREATIVE PACKAGE / 02</p><h2 id="project-heading">{pack.title}</h2>
              <p className="project-sub">{String(destination?.channelService??'Saluran')} · {pack.images.length} visual · fail asal</p>
            </div>
            <div className="tag-stack"><span className="badge neutral">VISUAL TEMPLAT</span>
              <span className="badge">{audit.reservationId?'RESERVASI DIREKODKAN':attempted?'PERLU SEMAK STATUS':'BELUM DITERBITKAN'}</span></div>
          </div>
          <div className="review-grid">
            <article className="card">
              <div className="card-pad"><div className="card-heading"><h3>Pratonton visual</h3>
                <span className="mini-note">Visual asal · bukan mockup AI</span></div></div>
              <div className="preview-stage">
                <span className="preview-index">{selectedFrame+1} / {pack.images.length}</span>
                <img src={pack.images[selectedFrame]}
                  alt={String((copy?.altTexts as string[]|undefined)?.[selectedFrame]??'Visual asal '+(selectedFrame+1))}/>
              </div>
              <p className="preview-caption">{String((script?.shots as string[]|undefined)?.[selectedFrame]??'Fail kandungan asal')}</p>
              <div className="thumb-list" aria-label="Pilih visual">
                {pack.images.map((src,index)=><button type="button" className={'thumb '+(selectedFrame===index?'active':'')}
                  onClick={()=>setActiveFrame(index)} key={index} aria-pressed={selectedFrame===index} aria-label={'Imej '+(index+1)}>
                  <img src={src} alt=""/><span>{index+1}</span>
                </button>)}
              </div>
            </article>
            <div className="detail-stack">
              <article className="card card-pad">
                <div className="card-heading"><h3>Skrip &amp; mesej</h3><span className="mini-note">BROS SELL</span></div>
                <dl>{Object.entries(script??{}).filter(([k])=>!['scriptId','revisionId','shots'].includes(k)).map(([k,v])=>
                  <div key={k} className="script-row"><dt>{scriptLabels[k]??k}</dt><dd>{String(v)}</dd></div>)}</dl>
              </article>
              <article className="card card-pad">
                <div className="card-heading"><h3>Kapsyen</h3><span className="mini-note">Draf asal</span></div>
                <p className="copy-text">{String(copy?.caption??'Tiada kapsyen')}</p>
                <div className="content-divider"/>
                <div className="note-row"><span>Pendedahan AI</span><span>{String(copy?.aiDisclosure??'—')}</span></div>
              </article>
              <article className="card card-pad">
                <div className="card-heading"><h3>Nilai kepada audiens</h3><span className="mini-note">Satu prinsip</span></div>
                <dl>{Object.entries(resource??{}).filter(([k])=>k!=='resourceId').map(([k,v])=>
                  <div key={k} className="script-row"><dt>{resourceLabels[k]??k}</dt><dd>{String(v)}</dd></div>)}</dl>
                <div className="content-divider"/>
                <p className="mini-note">Destinasi: {String(destination?.channelService??'—')} · {String(destination?.channelId??'—')}</p>
              </article>
            </div>
          </div>
          <section id="review" className="approval-card" aria-labelledby="approval-heading">
            <div className="approval-header">
              <div><p className="eyebrow">EDITORIAL GATE / 03</p><h2 id="approval-heading">Semakan &amp; kelulusan</h2></div>
              <span className="badge neutral">{completedChecks} / {required.length} syarat</span>
            </div>
            <p className="approval-sub">Tandakan hanya perkara yang telah anda periksa sendiri. Keputusan ditandatangani oleh kunci peribadi di pelayar anda. Jangan hantar semula keputusan yang telah direkodkan.</p>
            <div className="review-list">
              {required.map(check=><label className="review-choice" key={check}>
                <input type="checkbox" disabled={attempted||busy} checked={checked.includes(check)}
                  onChange={e=>setChecked(e.target.checked?[...checked,check]:checked.filter(x=>x!==check))}/>
                <span>{labels[check]??check}</span>
              </label>)}
            </div>
            <div className="approval-actions">
              <button type="button" className="button-primary" onClick={()=>void approve()} disabled={!canApprove}>
                Rekod kelulusan dan tempahan
              </button>
              <p>Kelulusan bukan penerbitan. Tiada hantaran akan dihantar oleh butang ini.</p>
            </div>
          </section>
        </section>}
        {pack&&handoffUrl&&<section className="demand-next" aria-labelledby="demand-heading">
          <div><p className="eyebrow">NEXT / DEMAND</p><h2 id="demand-heading">Sambung ke BROS DEMAND</h2>
            <p>Rujukan pelan dan cap jari kreatif lengkap akan disertakan. Ini belum mengesahkan hantaran atau hasil jualan.</p>
          </div>
          <a className="button-primary" href={handoffUrl} target="_blank" rel="noopener noreferrer">Buka BROS DEMAND ↗</a>
        </section>}
        <details id="technical" className="technical">
          <summary>Persediaan penyemak dan rujukan operasi</summary>
          <div className="technical-inner">
            {setup&&!setup.ready&&<ul>{setup.missing.map(x=><li key={x}>{missingLabels[x]??x}</li>)}</ul>}
            {!key?<button className="outline-button" type="button" onClick={()=>void makeKey()} disabled={busy}>Sediakan kunci penyemak</button>
              :<><p>Kunci awam: <code>{key.keyId}</code>. Kunci peribadi kekal di pelayar.</p>
                <button className="outline-button" type="button" onClick={downloadPublicKey}>Muat turun kunci awam</button>
                {!setup?.registeredKeyIds.includes(key.keyId)&&<>
                  <p className="danger-note">Kunci belum didaftarkan pada Preview ini.</p>
                  <button className="outline-button" type="button" onClick={()=>void copyPublicKeyConfig()} disabled={busy}>Salin JSON kunci awam</button>
                  <p>Tetapan Vercel Preview: <code>BCI_NEON_DEV_CONTENT_REVIEW_PUBLIC_KEYS</code> · <code>feat/neon-bci-dev-ledger-20261025</code></p>
                  <a href="https://vercel.com/bolehejassolutions-8492/bros-commercial-intelligence/settings/environment-variables" target="_blank" rel="noopener noreferrer">Buka tetapan Vercel</a>
                  {publicKeyCopyMessage&&<p role="status">{publicKeyCopyMessage}</p>}
                </>}
              </>}
            {pack&&<p>ID pek: <code>{String(pack.envelope.proofEnvelopeId)}</code></p>}
            {Object.keys(audit).length>0&&<div className="reference-list">{Object.entries(audit).map(([k,v])=>
              <p key={k}>{k}: <code>{v}</code></p>)}</div>}
            <p>Rujukan ini tidak mengesahkan jualan, pembayaran atau penerbitan.</p>
          </div>
        </details>
      </div>
    </div>
  </main>;
}
