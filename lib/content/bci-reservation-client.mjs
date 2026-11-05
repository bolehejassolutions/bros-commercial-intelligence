// CONTENT transport for its exact original-byte/signed-review dispatch candidate.
// BCI independently verifies the real JWT, scope and durable approval. This
// client never turns a receipt into permission to publish or evidence of SENT.
import {createHash} from 'node:crypto';
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fields=['reviewPacketId','handoffId','signedReviewEvidenceId','planId',
  'mediaSetId','copySha256','providerOrganizationId','channelId'];
function exact(value,keys){
  return !!value&&typeof value==='object'&&!Array.isArray(value)&&
    [Object.prototype,null].includes(Object.getPrototypeOf(value))&&
    Reflect.ownKeys(value).length===keys.length&&keys.every(k=>{
      const d=Object.getOwnPropertyDescriptor(value,k);
      return d?.enumerable===true&&Object.hasOwn(d,'value');
    });
}
const deny=()=>{throw Error('CONTENT_BCI_RESERVATION_NOT_SUBMITTED');};

// requestToken must obtain a fresh Neon Auth JWT. fetchSameOrigin is the
// authenticated application's fetch (or its trusted server origin adapter).
// The caller cannot pass a destination URL, tenant, principal or product.
export function createContentBciReservationClient(deps){
  if(!exact(deps,['requestToken','fetchSameOrigin'])||
    typeof deps.requestToken!=='function'||typeof deps.fetchSameOrigin!=='function')deny();
  const {requestToken,fetchSameOrigin}=deps;
  return async(candidate,approvalId)=>{
    if(!exact(candidate,['dispatchIntentId','binding'])||
      typeof candidate.dispatchIntentId!=='string'||!ID.test(candidate.dispatchIntentId)||!exact(candidate.binding,fields)||
      !fields.every(k=>typeof candidate.binding[k]==='string'&&
        (k==='copySha256'?/^[0-9a-f]{64}$/.test(candidate.binding[k]):ID.test(candidate.binding[k])))||
      typeof approvalId!=='string'||!ID.test(approvalId))deny();
    // Pin source-derived binding before any token/network await.
    const dispatchIntentId=candidate.dispatchIntentId;
    const bindingSha256=createHash('sha256')
      .update(JSON.stringify(fields.map(k=>candidate.binding[k]))).digest('hex');
    const body=JSON.stringify({dispatchIntentId,approvalId,bindingSha256});
    let jwt;try{jwt=await requestToken();}catch{return deny();}
    if(typeof jwt!=='string'||jwt.length>16000||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(jwt))deny();
    try{
      // Exactly one request. An error/timeout may follow a committed append;
      // reconcile the existing intent before explicitly trying again.
      const response=await fetchSameOrigin('/api/internal/neon-content-reservation',{
        method:'POST',headers:{Authorization:'Bearer '+jwt,'Content-Type':'application/json'},
        body,credentials:'same-origin',cache:'no-store',redirect:'error',
        signal:AbortSignal.timeout(30000)
      });
      if(response.status!==200||!/no-store/i.test(response.headers.get('cache-control')||'')||
        !/application\/json/i.test(response.headers.get('content-type')||'')||
        !/Authorization/i.test(response.headers.get('vary')||''))throw Error();
      const raw=await response.text();if(raw.length>2048)throw Error();
      const p=JSON.parse(raw);
      if(!exact(p,['status','reservationId','postCommitReadback','providerSent','executionAllowed'])||
        p.postCommitReadback!==true||p.providerSent!==false||p.executionAllowed!==false||
        !(p.status==='reserved'&&typeof p.reservationId==='string'&&UUID.test(p.reservationId)||
          p.status==='reconciliation_required'&&p.reservationId===null))throw Error();
      return Object.freeze({status:'BCI_RESERVATION_RECEIPT_ONLY',dispatchIntentId,
        reservationStatus:p.status,reservationId:p.reservationId,
        postCommitReadbackReported:true,approvalGranted:false,
        providerSentVerified:false,measurementVerified:false,learningVerified:false,
        executionAllowed:false,customerSaasReady:false});
    }catch{throw Error('CONTENT_BCI_RESERVATION_UNCONFIRMED_RECONCILE_INTENT');}
  };
}
