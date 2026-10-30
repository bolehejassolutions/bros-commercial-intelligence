// CONTENT product-layer Buffer API capability preflight. Read-only and nonexecuting.
// Based on the connected Buffer create_post input contract observed 2026-10-28:
// Instagram exposes isAiGenerated; TikTok exposes it for VIDEO only; Facebook
// does not expose an isAiGenerated field in that mutation contract.
// Schema shape is not proof of account permission, API acceptance, platform
// disclosure, approval, generation provenance or publication.
import {createHash} from 'node:crypto';
const services=new Set(['facebook','instagram','tiktok']);
const identity=/^[A-Za-z0-9][A-Za-z0-9_.|:-]{1,127}$/;
const aiCaption=/(?:\bilustrasi\s+ai\b|\bimej\s+ai\b|\bai[-\s]?generated\b|\bgenerated\s+by\s+ai\b|\bdijana\s+(?:oleh\s+)?ai\b)/iu;
// Single caption classifier shared by preflight and provider observation.
// Keep Malaysian AI-provenance wording consistent across both gates.
export function contentCaptionDeclaresAi(value){
  return typeof value==='string'&&aiCaption.test(value.normalize('NFKC'));
}
function strict(x,keys){
  if(!x||typeof x!=='object'||Array.isArray(x)||
    ![Object.prototype,null].includes(Object.getPrototypeOf(x))||
    Reflect.ownKeys(x).length!==keys.length||
    Reflect.ownKeys(x).some(k=>typeof k!=='string'||!keys.includes(k)||
      !Object.getOwnPropertyDescriptor(x,k)?.enumerable||
      !Object.hasOwn(Object.getOwnPropertyDescriptor(x,k),'value')))
    throw Error('INVALID_CONTENT_BUFFER_CAPABILITY_INPUT');
}
export function inspectContentBufferDisclosureCapability(input){
  strict(input,['schemaVersion','product','tenantId','instanceId','planId',
    'approvalRequestId','channelService','assetTypes','aiDisclosure','caption']);
  if(input.schemaVersion!==1||input.product!=='content'||
    ![input.tenantId,input.instanceId,input.planId,input.approvalRequestId]
      .every(x=>typeof x==='string'&&identity.test(x))||
    !services.has(input.channelService))throw Error('INVALID_CONTENT_BUFFER_CAPABILITY_SCOPE');
  const types=input.assetTypes;
  if(!Array.isArray(types)||types.length<1||types.length>20||
    Reflect.ownKeys(types).length!==types.length+1||
    !types.every((v,i)=>Object.getOwnPropertyDescriptor(types,String(i))?.value===v&&
      ['image','video'].includes(v))||
    new Set(types).size!==1)throw Error('INVALID_CONTENT_BUFFER_MEDIA_TYPES');
  if(!['DECLARED_AI','DECLARED_NON_AI','UNKNOWN'].includes(input.aiDisclosure)||
    typeof input.caption!=='string'||input.caption!==input.caption.trim()||
    input.caption.length<2||input.caption.length>5000||
    /[\u0000-\u0009\u000b-\u001f\u007f]/u.test(input.caption))
    throw Error('INVALID_CONTENT_BUFFER_DISCLOSURE_COPY');
  const mediaType=types[0],ai=input.aiDisclosure==='DECLARED_AI';
  const metadataFieldExposed=input.channelService==='instagram'||
    (input.channelService==='tiktok'&&mediaType==='video');
  const captionDeclaresAi=contentCaptionDeclaresAi(input.caption);
  const flags=[];
  if(input.aiDisclosure==='UNKNOWN')flags.push('AI_PROVENANCE_UNRESOLVED');
  // A non-AI declaration contradicting an AI-generated illustration caption
  // must never silently pass disclosure preflight, even on Instagram where
  // the provider exposes a native AI metadata field. Hold for human review.
  if(input.aiDisclosure==='DECLARED_NON_AI'&&captionDeclaresAi)
    flags.push('AI_PROVENANCE_CAPTION_CONTRADICTION');
  if(ai&&!captionDeclaresAi)flags.push('AI_CAPTION_DISCLOSURE_MISSING');
  if(ai&&!metadataFieldExposed)flags.push(
    input.channelService==='tiktok'?'TIKTOK_PHOTO_AI_METADATA_NOT_SUPPORTED_IN_BUFFER_CREATE_POST':
      'FACEBOOK_AI_METADATA_NOT_EXPOSED_IN_BUFFER_CREATE_POST');
  const hash=createHash('sha256').update(JSON.stringify([1,input.product,input.tenantId,
    input.instanceId,input.planId,input.approvalRequestId,input.channelService,
    mediaType,types.length,input.aiDisclosure,input.caption])).digest('hex');
  return Object.freeze({
    schemaVersion:1,product:'content',tenantId:input.tenantId,
    instanceId:input.instanceId,planId:input.planId,
    approvalRequestId:input.approvalRequestId,
    capabilityPreflightId:'content-buffer-capability-'+hash,
    channelService:input.channelService,mediaType,assetCount:types.length,
    aiDisclosure:input.aiDisclosure,captionDeclaresAi,
    bufferCreatePostAiMetadataFieldExposed:metadataFieldExposed,
    bufferCreatePostAiMetadataFieldScope:metadataFieldExposed?
      (input.channelService==='tiktok'?'TIKTOK_VIDEO_ONLY':'INSTAGRAM'):
      'NOT_EXPOSED_FOR_THIS_MEDIA',
    status:flags.length?'CAPABILITY_REVIEW_REQUIRED':'SCHEMA_PREFLIGHT_ONLY',
    flags:Object.freeze(flags),providerAccountCapabilityVerified:false,
    providerMetadataApplied:false,platformDisclosureVerified:false,
    authenticatedApprovalVerified:false,providerSentVerified:false,
    executionAllowed:false,customerSaasReady:false
  });
}
