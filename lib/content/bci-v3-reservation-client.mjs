// CONTENT-owned client for the existing BCI DEV reservation route.
// Reservation is NOT permission to publish. No external host, redirects or retries.
const deny=()=>{throw Error('CONTENT_V3_RESERVATION_UNCONFIRMED');};
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const exact=(v,keys)=>!!v&&typeof v==='object'&&!Array.isArray(v)&&
  Reflect.ownKeys(v).length===keys.length&&keys.every(k=>{
    const d=Object.getOwnPropertyDescriptor(v,k);
    return d?.enumerable===true&&Object.hasOwn(d,'value');
  });
/** Only call after independently verified BCI V3 durable issuance/readback.
 * No implicit retry: ambiguous network failure must be reconciled server-side.
 * The caller must supply a same-origin authenticated server fetch and a
 * separately confirmed BCI approval; CONTENT never manufactures approval IDs.
 */
export async function reserveContentV3Dispatch({origin,jwt,approval,fetchImpl=globalThis.fetch}){
  try{
    if(typeof origin!=='string'||typeof jwt!=='string'||typeof fetchImpl!=='function'||
      !exact(approval,['schemaVersion','status','dispatchIntentId','approvalId','bindingSha256','durableApprovalRecorded'])||
      approval.schemaVersion!==3||approval.status!=='BCI_V3_APPROVAL_COMMITTED_AND_READ_BACK'||
      approval.durableApprovalRecorded!==true||
      !ID.test(approval.dispatchIntentId)||!ID.test(approval.approvalId)||
      !SHA.test(approval.bindingSha256)||
      !/^[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$/.test(jwt))deny();
    const url=new URL(origin);
    if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||
      url.pathname!=='/'||!url.hostname||url.port)deny();
    const endpoint=new URL('/api/internal/neon-content-reservation',url);
    const response=await fetchImpl(endpoint.href,{
      method:'POST',redirect:'error',cache:'no-store',credentials:'omit',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+jwt,
        'Origin':url.origin},
      body:JSON.stringify({dispatchIntentId:approval.dispatchIntentId,
        approvalId:approval.approvalId,bindingSha256:approval.bindingSha256})
    });
    if(response.status!==200||!response.ok||
      new URL(response.url).origin!==url.origin||
      new URL(response.url).pathname!==endpoint.pathname)deny();
    const raw=await response.text();
    if(raw.length>2048)deny();
    const result=JSON.parse(raw);
    if(!exact(result,['status','reservationId','postCommitReadback','providerSent','executionAllowed'])||
      result.postCommitReadback!==true||result.providerSent!==false||
      result.executionAllowed!==false)deny();
    if(result.status==='reserved'&&typeof result.reservationId==='string'&&UUID.test(result.reservationId))
      return Object.freeze({status:'BCI_V3_RESERVATION_CONFIRMED_NO_DISPATCH',
        reservationId:result.reservationId,dispatchIntentId:approval.dispatchIntentId,
        providerSentVerified:false,executionAllowed:false});
    if(result.status==='reconciliation_required'&&result.reservationId===null)
      return Object.freeze({status:'BCI_V3_RESERVATION_RECONCILIATION_REQUIRED',
        reservationId:null,dispatchIntentId:approval.dispatchIntentId,
        providerSentVerified:false,executionAllowed:false});
    deny();
  }catch{return deny();}
}
