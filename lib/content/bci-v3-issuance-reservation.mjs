// CONTENT bridge from BCI's restricted V3 issueScript readback to reservation.
// The signed dispatch receipt supplies the intent and binding; neither is
// reconstructed from an untrusted HTTP request or a preflight-only result.
import {reserveContentV3Dispatch} from './bci-v3-reservation-client.mjs';
const deny=()=>{throw Error('CONTENT_V3_ISSUANCE_RESERVATION_DENIED');};
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const SHA=/^[a-f0-9]{64}$/;
const exact=(v,keys)=>!!v&&typeof v==='object'&&!Array.isArray(v)&&
  [Object.prototype,null].includes(Object.getPrototypeOf(v))&&
  Reflect.ownKeys(v).length===keys.length&&keys.every(k=>
    Object.getOwnPropertyDescriptor(v,k)?.enumerable===true&&
    Object.hasOwn(v,k));
/** Only a server-owned BCI issuer with restricted ledger access may be passed.
 * A real, separately signed human dispatch receipt is mandatory.
 * The caller must use the same authenticated server principal for issuance
 * and the reservation HTTP boundary; no publishing occurs here.
 */
export async function issueAndReserveContentV3({request,issueScript,origin,jwt,
  fetchImpl=globalThis.fetch}){
  try{
    if(typeof issueScript!=='function'||!exact(request,['envelope','mediaBytes','receipt'])||
      !exact(request.receipt,['editorial','script','dispatch']))deny();
    const pinned=structuredClone(request);
    const dispatch=pinned.receipt.dispatch;
    if(!exact(dispatch,['schemaVersion','keyId','payload','signature'])||
      dispatch.schemaVersion!==3||
      !dispatch.payload||dispatch.payload.schemaVersion!==3||
      dispatch.payload.product!=='content'||!ID.test(dispatch.payload.dispatchIntentId)||
      !SHA.test(dispatch.payload.bindingSha256)||!SHA.test(dispatch.payload.signedDispatchIntentSha256)||
      dispatch.payload.proofEnvelopeId!==pinned.envelope?.proofEnvelopeId||
      dispatch.payload.scriptIntentId!==pinned.envelope?.scriptIntentId||
      dispatch.payload.copySha256!==pinned.envelope?.copySha256||
      dispatch.payload.channelService!==pinned.envelope?.destination?.channelService||
      dispatch.payload.channelId!==pinned.envelope?.destination?.channelId)deny();
    // BCI verifies all three signatures, reviewer authority, original media,
    // immutable intent, and restricted database write plus readback.
    const issued=await issueScript(pinned);
    if(!exact(issued,['status','approvalId','committedReadback','providerSent','executionAllowed'])||
      issued.status!=='BCI_CONTENT_V3_APPROVAL_COMMITTED'||
      !ID.test(issued.approvalId)||issued.committedReadback!==true||
      issued.providerSent!==false||issued.executionAllowed!==false)deny();
    const approval=Object.freeze({schemaVersion:3,
      status:'BCI_V3_APPROVAL_COMMITTED_AND_READ_BACK',
      dispatchIntentId:dispatch.payload.dispatchIntentId,
      approvalId:issued.approvalId,bindingSha256:dispatch.payload.bindingSha256,
      durableApprovalRecorded:true});
    return await reserveContentV3Dispatch({origin,jwt,approval,fetchImpl});
  }catch{return deny();}
}
