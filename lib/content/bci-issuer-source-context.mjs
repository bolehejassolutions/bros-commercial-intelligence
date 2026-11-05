/** CONTENT-owned server-side source adapter for the BCI trusted single-image
 * approval issuer. The host must obtain these inputs from its trusted,
 * tenant-scoped storage, never from the HTTP request body. No reviewer
 * authorization, database write, or publishing is performed here.
 */
import {prepareContentSingleImageAdmissionMedia} from './single-image-admission-media.mjs';
import {prepareLocalContentEditorialHandoff} from './local-render-editorial-handoff.mjs';
import {prepareContentBufferDispatchIntent} from './buffer-dispatch-intent.mjs';
import {verifyContentAdmissionV2} from './signed-admission-v2.mjs';

const deny=()=>{throw Error('CONTENT_BCI_ISSUER_SOURCE_CONTEXT_DENIED');};
const BINDING=['reviewPacketId','handoffId','signedReviewEvidenceId',
  'planId','mediaSetId','copySha256','providerOrganizationId','channelId'];
function exact(value,fields){
  return !!value&&typeof value==='object'&&!Array.isArray(value)&&
    [Object.prototype,null].includes(Object.getPrototypeOf(value))&&
    Reflect.ownKeys(value).length===fields.length&&fields.every(k=>{
      const d=Object.getOwnPropertyDescriptor(value,k);
      return d?.enumerable===true&&Object.hasOwn(d,'value');
    });
}

/** Return the two callbacks required by createBciContentTrustedIssuer.
 * An explicit IMAGE_ONLY_NO_SCRIPT scope from trusted storage prevents a
 * script-bearing job from silently using the image-only V1/V2 issuer.
 * A real BCI JWT, live reviewer lookup and restricted ledger are still required.
 */
export function createContentBciIssuerSourceCallbacks({reviewScope,instanceConfig,
  brief,rendererManifest,proposedCopy,dispatchOptions,trustedPublicKeys,
  mediaOptions={},now=Date.now}){
  if(reviewScope!=='IMAGE_ONLY_NO_SCRIPT'||
    brief?.format!=='single_image'||brief?.assetCount!==1||
    !(trustedPublicKeys instanceof Map)||trustedPublicKeys.size===0||
    typeof now!=='function')deny();
  let snapshot;
  try{snapshot=structuredClone({instanceConfig,brief,rendererManifest,
    proposedCopy,dispatchOptions,mediaOptions});}catch{return deny();}
  const keys=new Map(trustedPublicKeys);
  const makeMedia=bytes=>prepareContentSingleImageAdmissionMedia(
    snapshot.instanceConfig,snapshot.brief,snapshot.rendererManifest,
    [Buffer.from(bytes)],snapshot.proposedCopy,snapshot.mediaOptions);
  return Object.freeze({
    recomputeOriginalMedia:async bytes=>{
      try{
        if(!Buffer.isBuffer(bytes)&&!(bytes instanceof Uint8Array))deny();
        return makeMedia(bytes).originalMedia;
      }catch{return deny();}
    },
    verifyContentSourceContext:async(pinned,bytes,admitted)=>{
      try{
        if(!Buffer.isBuffer(bytes)&&!(bytes instanceof Uint8Array)||
          !exact(pinned,['dispatchIntentId','binding','receipt'])||
          !exact(pinned.binding,BINDING)||
          !exact(pinned.receipt,['editorial','admission'])||
          !admitted||typeof admitted!=='object')deny();
        const media=makeMedia(bytes);
        const handoff=prepareLocalContentEditorialHandoff(
          snapshot.instanceConfig,snapshot.brief,snapshot.rendererManifest,
          [Buffer.from(bytes)],snapshot.proposedCopy,snapshot.mediaOptions);
        const dispatch=prepareContentBufferDispatchIntent(
          snapshot.instanceConfig,snapshot.brief,[Buffer.from(bytes)],
          snapshot.proposedCopy,snapshot.dispatchOptions,snapshot.mediaOptions);
        if(handoff.automatedReviewFlags.length!==0||
          dispatch.reviewFlags.length!==0||
          dispatch.status!=='ATOMIC_RESERVATION_AND_APPROVAL_REQUIRED')deny();
        const checked=verifyContentAdmissionV2(handoff,
          pinned.receipt.editorial,{originalMedia:media.originalMedia,
            mediaBytes:Buffer.from(bytes)},dispatch,pinned.receipt.admission,
          keys,now());
        if(pinned.dispatchIntentId!==checked.dispatchIntentId||
          !BINDING.every(k=>pinned.binding[k]===checked.binding[k])||
          admitted.tenantId!==handoff.tenantId||
          admitted.dispatchIntentId!==checked.dispatchIntentId||
          admitted.reviewerId!==checked.verified.reviewerSubject||
          admitted.signedReviewEvidenceId!==checked.verified.signedReviewEvidenceId||
          admitted.originalMediaSha256!==media.originalMedia.originalMediaSha256||
          admitted.mediaCount!==1||
          admitted.bindingSha256!==checked.bindingSha256||
          admitted.dispatchIntentSha256!==checked.verified.signedDispatchIntentSha256)
          deny();
        return true;
      }catch{return deny();}
    }
  });
}
