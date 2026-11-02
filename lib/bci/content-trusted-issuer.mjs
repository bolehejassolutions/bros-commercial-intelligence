/** BCI DEV trusted CONTENT approval orchestration, not an HTTP route or publisher.
 * V1 editorial and V2 single-image admission MUST be independently signed by
 * an approved Ed25519 key. Server-owned original-media recomputation must
 * validate the complete PNG, handoff and dispatch source; a digest alone is
 * insufficient. The restricted ledger separately checks live reviewer rights.
 * Until a real restricted LOGIN and human review exist, issuance fails closed.
 * Script/carousel approval is intentionally unsupported by V1+V2.
 */
import {createHash,verify,KeyObject} from 'node:crypto';
import {createBciContentApprovalAdmission} from './content-approval-issuance-admission.mjs';
import {createBciContentRestrictedApprovalLedger} from './neon-content-approval-atomic.mjs';
const V1=['schemaVersion','product','tenantId','instanceId','planId','mediaSetId',
 'approvalRequestId','reviewPacketId','handoffId','reviewerSubject','reviewerProvider',
 'reviewedAt','expiresAt','nonce','decision','checkResults'];
const V2=['schemaVersion','product','tenantId','instanceId','handoffId',
 'reviewPacketId','mediaSetId','signedReviewEvidenceId','originalMediaSha256',
 'mediaCount','dispatchIntentId','signedDispatchIntentSha256','reviewerSubject',
 'reviewerProvider','reviewedAt','expiresAt','nonce'];
const R=['schemaVersion','keyId','payload','signature'];
const SHA=/^[a-f0-9]{64}$/;
const NONCE=/^[a-f0-9]{32,64}$/;
const deny=()=>{throw Error('BCI_CONTENT_TRUSTED_ISSUER_DENIED');};
const hash=x=>createHash('sha256').update(x).digest('hex');
function exact(x,fields){
 return !!x&&typeof x==='object'&&!Array.isArray(x)&&
 [Object.prototype,null].includes(Object.getPrototypeOf(x))&&
 Reflect.ownKeys(x).length===fields.length&&fields.every(k=>{
  const d=Object.getOwnPropertyDescriptor(x,k);
  return d?.enumerable===true&&Object.hasOwn(d,'value');
 });
}
function signed(receipt,version,fields,domain,keys){
 if(!exact(receipt,R)||receipt.schemaVersion!==version||
   typeof receipt.keyId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.|:-]{1,63}$/.test(receipt.keyId)||
   typeof receipt.signature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(receipt.signature)||
   !exact(receipt.payload,fields))deny();
 const key=keys.get(receipt.keyId);
 if(!(key instanceof KeyObject)||key.type!=='public'||key.asymmetricKeyType!=='ed25519')deny();
 const sig=Buffer.from(receipt.signature,'base64url');
 const bytes=Buffer.from(domain+'\n'+JSON.stringify(fields.map(k=>receipt.payload[k])),'utf8');
 if(sig.length!==64||sig.toString('base64url')!==receipt.signature||
    !verify(null,bytes,key,sig))deny();
 return {p:receipt.payload,bytes,sig};
}
/** The caller supplies a real server-side PNG+handoff recomputation callback,
 * a verified Neon Auth principal, and fresh authoritative reviewer lookup.
 * These are NOT accepted from HTTP request JSON or JWT custom claims.
 */
export function createBciContentTrustedIssuer({trustedPublicKeys,
 authenticateReviewer,readReviewerAuthority,recomputeOriginalMedia,
 verifyContentSourceContext,writeTransaction,readTransaction,now}){
 if(!(trustedPublicKeys instanceof Map)||trustedPublicKeys.size===0||
   [authenticateReviewer,readReviewerAuthority,recomputeOriginalMedia,
    verifyContentSourceContext,writeTransaction,readTransaction,now].some(f=>typeof f!=='function'))deny();
 const keys=new Map(trustedPublicKeys);
 const ledger=createBciContentRestrictedApprovalLedger({writeTransaction,readTransaction});
 const admission=createBciContentApprovalAdmission({authenticateReviewer,
  readReviewerAuthority,recomputeOriginalMedia,now,
  verifySignedReceipt:async(receipts,media)=>{
   if(!exact(receipts,['editorial','admission']))deny();
   const v1=signed(receipts.editorial,1,V1,'BROS_CONTENT_SIGNED_REVIEW_V1',keys);
   const v2=signed(receipts.admission,2,V2,'BROS_CONTENT_SIGNED_ADMISSION_V2',keys);
   const a=v1.p,b=v2.p;
   const evidenceId='content-signed-review-'+hash(Buffer.concat([v1.bytes,v1.sig]));
   if(receipts.editorial.keyId!==receipts.admission.keyId||
      a.schemaVersion!==1||b.schemaVersion!==2||
      a.product!=='content'||b.product!=='content'||a.decision!=='APPROVE'||
      a.reviewerProvider!=='neon-auth'||b.reviewerProvider!=='neon-auth'||
      a.reviewerSubject!==b.reviewerSubject||a.tenantId!==b.tenantId||
      a.instanceId!==b.instanceId||a.planId===undefined||
      a.reviewPacketId!==b.reviewPacketId||a.handoffId!==b.handoffId||
      a.mediaSetId!==b.mediaSetId||a.reviewedAt!==b.reviewedAt||
      a.expiresAt!==b.expiresAt||a.nonce===b.nonce||
      !NONCE.test(a.nonce)||!NONCE.test(b.nonce)||
      b.signedReviewEvidenceId!==evidenceId||
      b.mediaCount!==1||b.originalMediaSha256!==media.originalMediaSha256||
      !SHA.test(b.signedDispatchIntentSha256)||
      !Array.isArray(a.checkResults)||a.checkResults.length===0||
      Reflect.ownKeys(a.checkResults).length!==a.checkResults.length+1||
      a.checkResults.some(x=>!exact(x,['check','passed'])||
        typeof x.check!=='string'||x.passed!==true))deny();
   // V2's signature binds the entire dispatch tuple, but only the separate
   // admission gate checks it against independently recomputed server input.
   return Object.freeze({product:'content',tenantId:b.tenantId,
    reviewerSubject:b.reviewerSubject,reviewerProvider:'neon-auth',
    signedDecision:'APPROVE',signatureVerified:true,
    signedReviewEvidenceId:evidenceId,expiresAt:b.expiresAt,
    handoffId:b.handoffId,reviewPacketId:b.reviewPacketId,
    mediaSetId:b.mediaSetId,originalMediaSha256:b.originalMediaSha256,
    mediaCount:1,signedDispatchIntentSha256:b.signedDispatchIntentSha256});
  }});
 return Object.freeze({
  issue:async request=>{
   try{
    if(!exact(request,['dispatchIntentId','binding','mediaBytes','receipt'])||
       !exact(request.receipt,['editorial','admission']))deny();
    // Pin caller-owned receipts and media before any asynchronous provider IO.
    // Persist precisely the same snapshot that passes cryptographic checks.
    const pinned=structuredClone({dispatchIntentId:request.dispatchIntentId,
      binding:request.binding,receipt:request.receipt});
    const bytes=Buffer.from(request.mediaBytes);
    const editorial=JSON.stringify(pinned.receipt.editorial);
    const supplemental=JSON.stringify(pinned.receipt.admission);
    if(Buffer.byteLength(editorial)<80||Buffer.byteLength(editorial)>32768||
       Buffer.byteLength(supplemental)<80||Buffer.byteLength(supplemental)>32768)deny();
    const a=await admission({...pinned,mediaBytes:bytes});
    // Mandatory CONTENT-owned verifier recomputes source handoff, review
    // check names, original PNG integrity, caption and provider destination.
    // Signed bytes alone never establish editorial semantics.
    if(await verifyContentSourceContext(pinned,bytes,a)!==true)deny();
    const approvedAt=pinned.receipt.editorial.payload.reviewedAt;
    const expiresAt=pinned.receipt.admission.payload.expiresAt;
    const clock=now();
    if(!Number.isSafeInteger(clock)||!Number.isFinite(Date.parse(approvedAt))||
       Date.parse(approvedAt)>clock||Date.parse(expiresAt)<=clock)deny();
    const approvalId='content-approved-'+hash(JSON.stringify([
      a.tenantId,a.dispatchIntentId,a.signedReviewEvidenceId,
      pinned.receipt.admission.payload.nonce]));
    const p={approvalId,tenantId:a.tenantId,reviewerId:a.reviewerId,
      dispatchIntentId:a.dispatchIntentId,bindingSha256:a.bindingSha256,
      approvedAt,expiresAt,signedReviewEvidenceId:a.signedReviewEvidenceId,
      originalMediaSha256:a.originalMediaSha256,
      signedDispatchIntentSha256:a.dispatchIntentSha256,
      signedReviewReceipt:editorial,signedAdmissionReceipt:supplemental,
      signedAdmissionNonce:pinned.receipt.admission.payload.nonce};
    const write=await ledger.append(p);
    if(write.approvalId!==approvalId)deny();
    const read=await ledger.readback(p);
    if(read.status!=='committed_readback'||read.approvalId!==approvalId)deny();
    return Object.freeze({status:'BCI_CONTENT_APPROVAL_COMMITTED',approvalId,
      committedReadback:true,providerSent:false,executionAllowed:false});
   }catch{return deny();}
  }
 });
}
