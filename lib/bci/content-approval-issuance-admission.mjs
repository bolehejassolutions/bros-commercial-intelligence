// BCI shared-core DEV admission for CONTENT's future trusted approval issuer.
// The CONTENT worker owns original-byte handoff and Ed25519 receipt verification.
// Inject those VERIFIED server functions; never trust browser-provided summaries.
// No DB write, HTTP route, reviewer grant, provider dispatch or approval is enabled.
// Until CONTENT supplies an authenticated ordered-media-set byte envelope,
// this boundary admits ONLY a single original image, never a carousel subset.
import {createHash} from "node:crypto";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const SHA=/^[a-f0-9]{64}$/;
const BINDING=["reviewPacketId","handoffId","signedReviewEvidenceId","planId",
  "mediaSetId","copySha256","providerOrganizationId","channelId"];
const exact=(x,keys)=>!!x&&typeof x==="object"&&!Array.isArray(x)&&
  [Object.prototype,null].includes(Object.getPrototypeOf(x))&&
  Reflect.ownKeys(x).length===keys.length&&Reflect.ownKeys(x).every(k=>{
    const d=Object.getOwnPropertyDescriptor(x,k);
    return typeof k==="string"&&keys.includes(k)&&d?.enumerable===true&&
      Object.hasOwn(d,"value");
  });
const deny=()=>{throw Error("BCI_CONTENT_APPROVAL_ADMISSION_DENIED");};
const mediaKeys=["handoffId","reviewPacketId","mediaSetId","originalMediaSha256","mediaCount"];
const verifiedKeys=["product","tenantId","reviewerSubject","reviewerProvider",
  "signedDecision","signatureVerified","signedReviewEvidenceId","expiresAt",
  "handoffId","reviewPacketId","mediaSetId","originalMediaSha256","mediaCount",
  "signedDispatchIntentSha256"];
const authorityKeys=["principalId","tenantId","product","memberActive",
  "reviewerAuthorized","revokedAt"];
const principalKeys=["userId","authenticated"];
const validTime=s=>typeof s==="string"&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(s)&&
  Number.isFinite(Date.parse(s))&&new Date(s).toISOString()===s;

/**
 * This is an admission guard, NOT a trusted issuer. The future server-only
 * issuer must supply independent Neon Auth verification, authoritative live
 * membership + reviewer-role lookup, signed CONTENT receipt verification and
 * original-byte recomputation, and independently verify that the SIGNED
 * receipt covers the complete dispatch intent (not just the image), then
 * perform a separate atomic append-only
 * database issuance/audit transaction. Mock tests do not prove these services.
 */
export function createBciContentApprovalAdmission(deps){
  if(!exact(deps,["authenticateReviewer","readReviewerAuthority",
    "recomputeOriginalMedia","verifySignedReceipt","now"])||
    Object.values(deps).some(fn=>typeof fn!=="function"))deny();
  return async request=>{
    try{
      if(!exact(request,["dispatchIntentId","binding","mediaBytes","receipt"])||
        typeof request.dispatchIntentId!=="string"||!ID.test(request.dispatchIntentId)||
        !exact(request.binding,BINDING)||!BINDING.every(k=>
          typeof request.binding[k]==="string"&&
          (k==="copySha256"?SHA.test(request.binding[k]):ID.test(request.binding[k])))||
        !(request.mediaBytes instanceof Uint8Array)||
        request.mediaBytes.byteLength<32||request.mediaBytes.byteLength>20*1024*1024)deny();
      // Snapshot caller-owned data before the first await; never attest mutable input.
      const intent=request.dispatchIntentId;
      const b=Object.fromEntries(BINDING.map(k=>[k,request.binding[k]]));
      const originalBytes=Buffer.from(request.mediaBytes);
      const bindingSha256=createHash("sha256")
        .update(JSON.stringify(BINDING.map(k=>b[k]))).digest("hex");
      const dispatchIntentSha256=createHash("sha256")
        .update("BCI_CONTENT_DISPATCH_INTENT_V1\n")
        .update(JSON.stringify([intent,bindingSha256])).digest("hex");
      const rawMedia=await deps.recomputeOriginalMedia(originalBytes);
      if(!exact(rawMedia,mediaKeys))deny();
      // A trusted callback can return a mutable object; pin its signed inputs
      // before awaiting the next callback to avoid a TOCTOU proof swap.
      const media=Object.freeze(Object.fromEntries(mediaKeys.map(k=>[k,rawMedia[k]])));
      if(media.mediaCount!==1||!SHA.test(media.originalMediaSha256)||
        !["handoffId","reviewPacketId","mediaSetId"].every(k=>ID.test(media[k]))||
        media.originalMediaSha256!==createHash("sha256").update(originalBytes).digest("hex"))deny();
      const rawVerified=await deps.verifySignedReceipt(request.receipt,media);
      if(!exact(rawVerified,verifiedKeys))deny();
      // Keep the signature-verifier result immutable across later JWT and
      // authoritative membership awaits; never return post-check mutations.
      const verified=Object.freeze(Object.fromEntries(verifiedKeys.map(k=>[k,rawVerified[k]])));
      if(verified.mediaCount!==1||
        verified.originalMediaSha256!==media.originalMediaSha256||
        !SHA.test(verified.signedDispatchIntentSha256)||
        verified.signedDispatchIntentSha256!==dispatchIntentSha256||
        verified.product!=="content"||
        !UUID.test(verified.tenantId)||!UUID.test(verified.reviewerSubject)||
        verified.reviewerProvider!=="neon-auth"||
        verified.signedDecision!=="APPROVE"||verified.signatureVerified!==true||
        !ID.test(verified.signedReviewEvidenceId)||!validTime(verified.expiresAt)||
        !["handoffId","reviewPacketId","mediaSetId"].every(k=>verified[k]===media[k]))deny();
      const now=deps.now();
      if(!Number.isSafeInteger(now)||Date.parse(verified.expiresAt)<=now||
        Date.parse(verified.expiresAt)>now+24*60*60*1000)deny();
      if(b.handoffId!==media.handoffId||b.reviewPacketId!==media.reviewPacketId||
        b.mediaSetId!==media.mediaSetId||
        b.signedReviewEvidenceId!==verified.signedReviewEvidenceId)deny();
      const principal=await deps.authenticateReviewer();
      if(!exact(principal,principalKeys)||principal.authenticated!==true||
        !UUID.test(principal.userId)||principal.userId!==verified.reviewerSubject)deny();
      // The lookup MUST be a fresh, server-owned authoritative Neon read.
      // Never derive reviewer role from JWT custom claims, GUCs or caller data.
      const authority=await deps.readReviewerAuthority(principal.userId,"content");
      if(!exact(authority,authorityKeys)||authority.principalId!==principal.userId||
        authority.tenantId!==verified.tenantId||authority.product!=="content"||
        authority.memberActive!==true||authority.reviewerAuthorized!==true||
        authority.revokedAt!==null)deny();
      // The signed receipt must remain valid after asynchronous JWT and
      // authoritative membership checks. Earlier expiry validation alone
      // would admit an approval that expired while those checks were pending.
      const finalNow=deps.now();
      if(!Number.isSafeInteger(finalNow)||finalNow<now||
        Date.parse(verified.expiresAt)<=finalNow)deny();
      return Object.freeze({
        status:"ADMITTED_FOR_TRUSTED_ISSUER_ONLY",product:"content",
        tenantId:verified.tenantId,reviewerId:principal.userId,
        dispatchIntentId:intent,
        signedReviewEvidenceId:verified.signedReviewEvidenceId,
        originalMediaSha256:media.originalMediaSha256,mediaCount:1,bindingSha256,
        dispatchIntentSha256,
        expiresAt:verified.expiresAt,
        durableApprovalRecorded:false,providerSent:false,executionAllowed:false
      });
    }catch{return deny();}
  };
}
