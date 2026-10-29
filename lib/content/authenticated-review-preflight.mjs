// CONTENT product-layer bridge to the BCI-owned authenticated principal and
// authoritative tenant membership. No login, database, durable audit, or publish.
// Dependencies MUST be constructed by the trusted server using BCI shared core,
// never from client-provided claims. A test double is NOT provider evidence.
import {verifyContentSignedEditorialDecision} from './signed-editorial-decision.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const deny=()=>{throw Error('CONTENT_REVIEW_AUTHORITY_PREFLIGHT_DENIED');};
function exact(value,keys){
  if(!value||typeof value!=='object'||Array.isArray(value)||
      ![Object.prototype,null].includes(Object.getPrototypeOf(value)))return false;
  const own=Reflect.ownKeys(value);
  return own.length===keys.length&&own.every(key=>{
    if(typeof key!=='string'||!keys.includes(key))return false;
    const d=Object.getOwnPropertyDescriptor(value,key);
    return !!d&&d.enumerable&&Object.hasOwn(d,'value');
  });
}
/**
 * Checks signed editorial evidence against a fresh server-resolved principal
 * and product-scoped membership, reusing BCI's auth/membership dependencies.
 * This is NOT an approval grant: no durable record, revocation-safe dispatch,
 * independent visual QA, provider SENT, or audit is inferred.
 *
 * @param {object} handoff Freshly recomputed from actual original image bytes.
 * @param {object} receipt Signed review evidence, never a bearer credential.
 * @param {Map} trustedPublicKeys Server-configured signing trust anchors.
 * @param {{authenticateReviewer:()=>Promise<{userId:string,authenticated:true}>,
 *          membershipsFor:(userId:string,product:'content')=>Promise<Array>}} deps
 */
export async function prepareContentAuthenticatedReviewPreflight(handoff,receipt,trustedPublicKeys,deps,now=Date.now()){
  if(!exact(deps,['authenticateReviewer','membershipsFor'])||
      typeof deps.authenticateReviewer!=='function'||
      typeof deps.membershipsFor!=='function')deny();
  try{
    const signed=verifyContentSignedEditorialDecision(handoff,receipt,trustedPublicKeys,now);
    if(signed.signedDecision!=='APPROVE'||
        receipt.payload.reviewerProvider!=='neon-auth'||
        !UUID.test(receipt.payload.reviewerSubject)||
        !UUID.test(signed.tenantId))deny();
    // No caller-provided userId, tenant, role, or membership may select scope.
    const principal=await deps.authenticateReviewer();
    if(!exact(principal,['userId','authenticated'])||
        principal.authenticated!==true||!UUID.test(principal.userId)||
        principal.userId!==receipt.payload.reviewerSubject)deny();
    const memberships=await deps.membershipsFor(principal.userId,'content');
    if(!Array.isArray(memberships)||memberships.length!==1||
        !exact(memberships[0],['principalId','tenantId','product','active']))deny();
    const membership=memberships[0];
    if(membership.principalId!==principal.userId||
        membership.tenantId!==signed.tenantId||
        membership.product!=='content'||membership.active!==true)deny();
    return Object.freeze({schemaVersion:1,product:'content',tenantId:signed.tenantId,
      instanceId:signed.instanceId,planId:signed.planId,
      mediaSetId:signed.mediaSetId,approvalRequestId:signed.approvalRequestId,
      reviewPacketId:signed.reviewPacketId,handoffId:signed.handoffId,
      signedReviewEvidenceId:signed.signedReviewEvidenceId,
      status:'AUTHORITY_MATCHED_REVIEW_PREFLIGHT_ONLY',
      signedEvidenceVerified:true,serverPrincipalAndMembershipMatched:true,
      reviewerAuthenticatedByThisModule:false,visualEditorialQaVerified:false,
      approvalGranted:false,durableApprovalRecorded:false,
      atomicReservationVerified:false,providerSentVerified:false,
      measurementVerified:false,sharedBciAuditVerified:false,
      executionAllowed:false,customerSaasReady:false});
  }catch{return deny();}
}
