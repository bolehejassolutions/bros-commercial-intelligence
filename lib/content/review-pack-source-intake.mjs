// CONTENT-only intake of an UNBOUND editorial review pack and original PNG bytes.
// Reuses existing plan, source-byte and approval-request gates. No authentication,
// human approval, reservation, upload or publishing is performed.
import {inspectPlannedContentPngBytes} from './plan-source-byte-gate.mjs';
import {prepareContentApprovalRequest} from './approval-request.mjs';

const SHA=/^[a-f0-9]{64}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9_.|:-]{1,159}$/;
const deny=()=>{throw Error('CONTENT_UNBOUND_REVIEW_PACK_INTAKE_DENIED');};
function ownData(value,fields){
  if(!value||typeof value!=='object'||Array.isArray(value)||
    ![Object.prototype,null].includes(Object.getPrototypeOf(value)))return false;
  return fields.every(key=>{
    const d=Object.getOwnPropertyDescriptor(value,key);
    return d?.enumerable===true&&Object.hasOwn(d,'value');
  });
}
function dense(items,min,max){
  return Array.isArray(items)&&items.length>=min&&items.length<=max&&
    Reflect.ownKeys(items).length===items.length+1&&
    Array.from({length:items.length},(_,i)=>{
      const d=Object.getOwnPropertyDescriptor(items,String(i));
      return d?.enumerable===true&&Object.hasOwn(d,'value');
    }).every(Boolean);
}
/**
 * The source pack is UNTRUSTED editorial input. instanceConfig and brief must
 * come from an independently authenticated server in a future hosted flow.
 * Returned deterministic IDs are review candidates, never authorization.
 */
export function inspectUnboundContentReviewPackSource(pack,candidateId,
  instanceConfig,brief,sourceBuffers,options={}){
  try{
    if(!ownData(pack,['schemaVersion','product','scope','tenantId','instanceId',
      'providerOrganizationId','channelReviews','executionAllowed',
      'semanticReviewSigned','allAcceptanceGatesOpen'])||
      pack.schemaVersion!==1||pack.product!=='content'||
      pack.scope!=='UNBOUND_EDITORIAL_REVIEW_CANDIDATE_ONLY'||
      pack.tenantId!==null||pack.instanceId!==null||
      pack.providerOrganizationId!==null||pack.executionAllowed!==false||
      pack.semanticReviewSigned!==false||pack.allAcceptanceGatesOpen!==true||
      !ID.test(candidateId)||!dense(pack.channelReviews,1,10))deny();
    const seenCandidates=new Set(),seenFiles=new Set(),seenHashes=new Set(),
      seenRenderedPixels=new Set();
    for(const review of pack.channelReviews){
      if(!ownData(review,['service','format','assetCount','hook','caption',
        'altTexts','aiDisclosure','claimEvidenceRefs','media','reviewStatus',
        'reviewCandidateId','channelId','planId','mediaSetId',
        'approvalRequestId','signedApprovalId','providerSentId',
        'metrics','learning','executionAllowed'])||
        !ID.test(review.reviewCandidateId)||
        seenCandidates.has(review.reviewCandidateId)||
        review.reviewStatus!=='REVIEW_REQUIRED'||
        review.executionAllowed!==false||
        !['channelId','planId','mediaSetId','approvalRequestId',
          'signedApprovalId','providerSentId','metrics','learning']
          .every(k=>review[k]===null)||
        !['facebook','instagram','tiktok'].includes(review.service)||
        !['single_image','carousel'].includes(review.format)||
        !Number.isSafeInteger(review.assetCount)||
        (review.format==='single_image'&&review.assetCount!==1)||
        (review.format==='carousel'&&(review.assetCount<2||review.assetCount>20))||
        !dense(review.media,1,20)||review.media.length!==review.assetCount||
        !dense(review.altTexts,1,20)||review.altTexts.length!==review.assetCount||
        !dense(review.claimEvidenceRefs,0,20)||
        typeof review.hook!=='string'||typeof review.caption!=='string'||
        !['DECLARED_AI','DECLARED_NON_AI','UNKNOWN'].includes(review.aiDisclosure))deny();
      seenCandidates.add(review.reviewCandidateId);
      for(let i=0;i<review.media.length;i++){
        const media=review.media[i];
        if(!ownData(media,['slot','driveFileId','sourceSha256',
          'decodedRgbaSha256','byteLength','altText'])||
          media.slot!==i+1||!ID.test(media.driveFileId)||
          !SHA.test(media.sourceSha256)||!SHA.test(media.decodedRgbaSha256)||
          !Number.isSafeInteger(media.byteLength)||media.byteLength<32||
          media.altText!==review.altTexts[i]||
          seenFiles.has(media.driveFileId)||seenHashes.has(media.sourceSha256)||
          seenRenderedPixels.has(media.decodedRgbaSha256))deny();
        seenFiles.add(media.driveFileId);seenHashes.add(media.sourceSha256);
        seenRenderedPixels.add(media.decodedRgbaSha256);
      }
    }
    const review=pack.channelReviews.find(r=>r.reviewCandidateId===candidateId);
    if(!review||brief?.channelService!==review.service||
      brief?.format!==review.format||brief?.assetCount!==review.assetCount||
      brief?.hook!==review.hook||!dense(sourceBuffers,1,20)||
      sourceBuffers.length!==review.assetCount||
      sourceBuffers.some(b=>!Buffer.isBuffer(b)))deny();
    const inspected=inspectPlannedContentPngBytes(instanceConfig,brief,sourceBuffers,options);
    for(let i=0;i<review.assetCount;i++){
      const actual=inspected.images[i],claimed=review.media[i];
      if(actual.sha256!==claimed.sourceSha256||
        actual.decodedRgbaSha256!==claimed.decodedRgbaSha256||
        actual.byteLength!==claimed.byteLength)deny();
    }
    const copy={schemaVersion:1,caption:review.caption,
      altTexts:[...review.altTexts],aiDisclosure:review.aiDisclosure,
      claimEvidenceRefs:[...review.claimEvidenceRefs]};
    const request=prepareContentApprovalRequest(instanceConfig,brief,
      sourceBuffers,copy,options);
    if(request.planId!==inspected.planId||
      request.mediaSetId!==inspected.mediaSetId||
      request.imageDigests.some((d,i)=>d.sha256!==review.media[i].sourceSha256))deny();
    return Object.freeze({
      schemaVersion:1,product:'content',tenantId:request.tenantId,
      instanceId:request.instanceId,planId:request.planId,
      mediaSetId:request.mediaSetId,approvalRequestId:request.approvalRequestId,
      copySha256:request.copySha256,reviewCandidateId:candidateId,
      sourceDriveFileIds:Object.freeze(review.media.map(x=>x.driveFileId)),
      status:'SOURCE_BYTES_MATCHED_REVIEW_REQUIRED',
      originalSourceBytesVerified:true,distinctRenderedPixelsVerified:true,
      sourceReferencesAuthenticated:false,instanceBindingAuthenticated:false,
      visualEditorialQaVerified:false,signedHumanReviewVerified:false,
      providerCapabilityVerified:false,durableApprovalRecorded:false,
      atomicReservationVerified:false,providerSentVerified:false,
      measurementVerified:false,learningVerified:false,
      executionAllowed:false,customerSaasReady:false
    });
  }catch{return deny();}
}


/**
 * Whole-pack review-only admission: every ordered original PNG buffer must be
 * supplied and independently matched, not merely the selected channel.
 * Caller configs are still UNAUTHENTICATED; this never issues BCI approval,
 * creates a reservation, or grants publication authority.
 */
export function inspectUnboundContentReviewPackAllSources(pack,channelInputs){
  try{
    if(!ownData(pack,['channelReviews'])||
       !dense(pack.channelReviews,1,10)||!dense(channelInputs,1,10)||
       channelInputs.length!==pack.channelReviews.length)deny();
    const seenCandidates=new Set(),seenChannels=new Set(),results=[];
    let tenantId=null,instanceId=null,imageCount=0;
    for(const input of channelInputs){
      if(!ownData(input,['candidateId','instanceConfig','brief','sourceBuffers'])||
         !Reflect.ownKeys(input).every(k=>
           typeof k==='string'&&['candidateId','instanceConfig','brief',
             'sourceBuffers','options'].includes(k)&&
           Object.getOwnPropertyDescriptor(input,k)?.enumerable===true&&
           Object.hasOwn(Object.getOwnPropertyDescriptor(input,k),'value'))||
         !ID.test(input.candidateId)||seenCandidates.has(input.candidateId)||
         !input.brief||typeof input.brief!=='object')deny();
      const review=pack.channelReviews.find(r=>r.reviewCandidateId===input.candidateId);
      if(!review)deny();
      const verified=inspectUnboundContentReviewPackSource(pack,input.candidateId,
        input.instanceConfig,input.brief,input.sourceBuffers,input.options??{});
      const channelKey=JSON.stringify([input.brief.channelService,input.brief.channelId]);
      if(seenChannels.has(channelKey)||verified.executionAllowed!==false||
         verified.originalSourceBytesVerified!==true||
         verified.distinctRenderedPixelsVerified!==true)deny();
      if(tenantId===null){tenantId=verified.tenantId;instanceId=verified.instanceId;}
      else if(tenantId!==verified.tenantId||instanceId!==verified.instanceId)deny();
      seenCandidates.add(input.candidateId);seenChannels.add(channelKey);
      imageCount+=review.assetCount;
      results.push(Object.freeze({
        service:review.service,channelId:input.brief.channelId,
        reviewCandidateId:input.candidateId,planId:verified.planId,
        mediaSetId:verified.mediaSetId,approvalRequestId:verified.approvalRequestId,
        sourceDriveFileIds:verified.sourceDriveFileIds
      }));
    }
    if(seenCandidates.size!==pack.channelReviews.length)deny();
    return Object.freeze({
      schemaVersion:1,product:'content',tenantId,instanceId,
      channelCount:results.length,imageCount,
      channels:Object.freeze(results),
      status:'ALL_ORIGINAL_BYTES_MATCHED_REVIEW_REQUIRED',
      allChannelOriginalBytesVerified:true,allRenderedPixelsDistinct:true,
      sourceReferencesAuthenticated:false,instanceBindingAuthenticated:false,
      visualEditorialQaVerified:false,signedHumanReviewVerified:false,
      durableApprovalRecorded:false,atomicReservationVerified:false,
      providerSentVerified:false,measurementVerified:false,
      learningVerified:false,executionAllowed:false,customerSaasReady:false
    });
  }catch{return deny();}
}
