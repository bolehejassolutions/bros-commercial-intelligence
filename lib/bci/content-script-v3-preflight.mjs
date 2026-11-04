// BCI-owned V3 complete-script preflight. Never issues an approval or dispatch.
// This boundary consumes independently signed image/editorial AND complete-script
// reviews; it cannot downgrade a multi-image script to V2 single-image approval.
import {createHash,verify,KeyObject} from 'node:crypto';
const deny=()=>{throw Error('BCI_CONTENT_SCRIPT_V3_DENIED');};
const h=x=>createHash('sha256').update(x).digest('hex');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/;
const NONCE=/^[0-9a-f]{32,64}$/;
const R=['schemaVersion','keyId','payload','signature'];
const V1=['schemaVersion','product','tenantId','instanceId','planId','mediaSetId',
  'approvalRequestId','reviewPacketId','handoffId','reviewerSubject','reviewerProvider',
  'reviewedAt','expiresAt','nonce','decision','checkResults'];
const SCRIPT=['schemaVersion','product','proofEnvelopeId','tenantId','instanceId',
  'planId','reviewPacketId','scriptIntentId','copySha256','channelService',
  'channelId','reviewerSubject','reviewerProvider','reviewedAt','expiresAt',
  'nonce','decision','scriptCheckResults'];
const CHECKS=[
 'VERIFY_SCRIPT_SHOTS_MATCH_RENDERED_MEDIA_SEMANTICALLY',
 'VERIFY_RESOURCE_MAPPING_INPUT_ACTION_OUTPUT_AND_PAYOFF',
 'VERIFY_SCRIPT_COPY_CLAIMS_RIGHTS_AND_DISCLOSURE'
];
const exact=(obj,fields)=>!!obj&&typeof obj==='object'&&!Array.isArray(obj)&&
  [Object.prototype,null].includes(Object.getPrototypeOf(obj))&&
  Reflect.ownKeys(obj).length===fields.length&&fields.every(k=>{
   const d=Object.getOwnPropertyDescriptor(obj,k);
   return d?.enumerable===true&&Object.hasOwn(d,'value');
  });
const validTime=s=>typeof s==='string'&&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(s)&&
  Number.isFinite(Date.parse(s))&&new Date(s).toISOString()===s;
function verifyReceipt(receipt,fields,domain,keys){
 if(!exact(receipt,R)||receipt.schemaVersion!==1||
    !exact(receipt.payload,fields)||typeof receipt.keyId!=='string'||
    !/^[A-Za-z0-9][A-Za-z0-9_.|:-]{1,63}$/.test(receipt.keyId)||
    typeof receipt.signature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(receipt.signature))deny();
 const key=keys.get(receipt.keyId);
 if(!(key instanceof KeyObject)||key.type!=='public'||key.asymmetricKeyType!=='ed25519')deny();
 const bytes=Buffer.from(domain+'\n'+JSON.stringify(fields.map(k=>receipt.payload[k])),'utf8');
 const sig=Buffer.from(receipt.signature,'base64url');
 if(sig.length!==64||sig.toString('base64url')!==receipt.signature||
   !verify(null,bytes,key,sig))deny();
 return {payload:receipt.payload,bytes,signature:sig};
}
function checks(results,names){
 if(!Array.isArray(results)||results.length!==names.length||
   Reflect.ownKeys(results).length!==results.length+1)deny();
 for(let i=0;i<names.length;i++){
  const d=Object.getOwnPropertyDescriptor(results,String(i));
  if(!d?.enumerable||!Object.hasOwn(d,'value')||
    !exact(d.value,['check','passed'])||d.value.check!==names[i]||
    d.value.passed!==true)deny();
 }
}
function frozenManifest(buffers){
 if(!Array.isArray(buffers)||buffers.length<2||buffers.length>6||
    Reflect.ownKeys(buffers).length!==buffers.length+1)deny();
 const pins=[];
 for(let i=0;i<buffers.length;i++){
  if(!(buffers[i] instanceof Uint8Array)||
     buffers[i].byteLength<32||buffers[i].byteLength>20*1024*1024)deny();
  pins.push({slot:i+1,sourceSha256:h(Buffer.from(buffers[i]))});
 }
 return Object.freeze(pins.map(x=>Object.freeze(x)));
}
function binding(envelope,editorial,script,pins){
 if(!envelope||envelope.schemaVersion!==3||envelope.product!=='content'||
   !Array.isArray(envelope.orderedMediaDigests)||
   !Array.isArray(envelope.shotMediaBindings)||
   envelope.orderedMediaDigests.length!==pins.length||
   envelope.shotMediaBindings.length!==pins.length||
   !Array.isArray(envelope.automatedReviewFlags)||
   envelope.automatedReviewFlags.length!==0||
   typeof envelope.proofEnvelopeId!=='string'||
   !/^content-instance-script-proof-[a-f0-9]{64}$/.test(envelope.proofEnvelopeId)||
   typeof envelope.copySha256!=='string'||!SHA.test(envelope.copySha256)||
   envelope.executionAllowed!==false||envelope.durableApprovalRecorded!==false||
   envelope.humanImageReviewSigned!==false||envelope.humanScriptReviewSigned!==false||
   !envelope.destination||typeof envelope.destination.channelService!=='string'||
   typeof envelope.destination.channelId!=='string'||
   envelope.destination.providerOrganizationId!==null)deny();
 if(envelope.script?.shots?.length!==pins.length)deny();
 for(let i=0;i<pins.length;i++){
   const m=envelope.orderedMediaDigests[i],s=envelope.shotMediaBindings[i];
   if(!m||m.slot!==i+1||m.sourceSha256!==pins[i].sourceSha256||
      !SHA.test(m.decodedRgbaSha256)||!s||s.shotIndex!==i+1||
      s.mediaSlot!==i+1||s.sourceSha256!==pins[i].sourceSha256||
      s.decodedRgbaSha256!==m.decodedRgbaSha256||
      s.shot!==envelope.script.shots[i])deny();
 }
 const a=editorial.payload,b=script.payload;
 if(a.tenantId!==envelope.tenantId||b.tenantId!==envelope.tenantId||
   a.instanceId!==envelope.instanceId||b.instanceId!==envelope.instanceId||
   a.planId!==envelope.planId||b.planId!==envelope.planId||
   a.reviewPacketId!==envelope.reviewPacketId||b.reviewPacketId!==envelope.reviewPacketId||
   a.mediaSetId!==envelope.mediaSetId||
   b.proofEnvelopeId!==envelope.proofEnvelopeId||
   b.scriptIntentId!==envelope.scriptIntentId||
   b.copySha256!==envelope.copySha256||
   b.channelService!==envelope.destination.channelService||
   b.channelId!==envelope.destination.channelId)deny();
 return Object.freeze({proofEnvelopeId:b.proofEnvelopeId,
   scriptIntentId:b.scriptIntentId,copySha256:b.copySha256,
   orderedMediaSha256:h('BCI_CONTENT_ORDERED_MEDIA_V3\n'+
     JSON.stringify(pins.map(x=>[x.slot,x.sourceSha256])))});
}
/** The caller MUST inject an authenticated server-side source recomputation.
 * Return true only after recomputing the complete versioned envelope from
 * original ordered bytes, copy, script, resource and destination.
 * This function never accepts browser-provided summaries as authority.
 */
export function createBciContentScriptV3Preflight({trustedPublicKeys,
 authenticateReviewer,readReviewerAuthority,verifyServerSource,now}){
 if(!(trustedPublicKeys instanceof Map)||trustedPublicKeys.size===0||
   [authenticateReviewer,readReviewerAuthority,verifyServerSource,now]
    .some(f=>typeof f!=='function'))deny();
 const keys=new Map(trustedPublicKeys);
 return async request=>{
  try{
   if(!exact(request,['envelope','mediaBytes','receipt'])||
     !exact(request.receipt,['editorial','script']))deny();
   const pinned=structuredClone({envelope:request.envelope,receipt:request.receipt});
   const pins=frozenManifest(request.mediaBytes);
   const privateBytes=request.mediaBytes.map(x=>Buffer.from(x));
   const editorial=verifyReceipt(pinned.receipt.editorial,V1,
     'BROS_CONTENT_SIGNED_REVIEW_V1',keys);
   const script=verifyReceipt(pinned.receipt.script,SCRIPT,
     'BROS_CONTENT_INSTANCE_SCRIPT_SIGNED_REVIEW_V1',keys);
   const a=editorial.payload,b=script.payload;
   if(pinned.receipt.editorial.keyId!==pinned.receipt.script.keyId||
     a.schemaVersion!==1||b.schemaVersion!==1||
     a.product!=='content'||b.product!=='content'||
     a.decision!=='APPROVE'||b.decision!=='APPROVE'||
     a.reviewerProvider!=='neon-auth'||b.reviewerProvider!=='neon-auth'||
     !UUID.test(a.reviewerSubject)||b.reviewerSubject!==a.reviewerSubject||
     !UUID.test(a.tenantId)||b.tenantId!==a.tenantId||
     !NONCE.test(a.nonce)||!NONCE.test(b.nonce)||a.nonce===b.nonce||
     !validTime(a.reviewedAt)||!validTime(b.reviewedAt)||
     !validTime(a.expiresAt)||!validTime(b.expiresAt)||
     Date.parse(b.reviewedAt)<=Date.parse(a.reviewedAt)||
     Date.parse(b.expiresAt)>Date.parse(a.expiresAt))deny();
   if(!Array.isArray(a.checkResults)||a.checkResults.length===0||
      Reflect.ownKeys(a.checkResults).length!==a.checkResults.length+1)deny();
   for(const c of a.checkResults){
    if(!exact(c,['check','passed'])||c.passed!==true||
       typeof c.check!=='string'||c.check.length<3)deny();
   }
   checks(b.scriptCheckResults,CHECKS);
   const nowMs=now();
   if(!Number.isSafeInteger(nowMs)||Date.parse(b.reviewedAt)>nowMs||
      Date.parse(b.expiresAt)<=nowMs||
      Date.parse(b.expiresAt)>nowMs+86400000)deny();
   const bound=binding(pinned.envelope,editorial,script,pins);
   const evidenceId='content-instance-script-signed-'+
     h(Buffer.concat([script.bytes,script.signature]));
   if(await verifyServerSource(structuredClone(pinned),
     privateBytes.map(x=>Buffer.from(x)),bound)!==true)deny();
   const principal=await authenticateReviewer();
   if(!exact(principal,['userId','authenticated'])||
      principal.authenticated!==true||principal.userId!==a.reviewerSubject)deny();
   const authority=await readReviewerAuthority(principal.userId,'content');
   if(!exact(authority,['principalId','tenantId','product','memberActive',
        'reviewerAuthorized','revokedAt'])||
      authority.principalId!==principal.userId||
      authority.tenantId!==a.tenantId||authority.product!=='content'||
      authority.memberActive!==true||authority.reviewerAuthorized!==true||
      authority.revokedAt!==null||
      !Number.isSafeInteger(now())||Date.parse(b.expiresAt)<=now())deny();
   return Object.freeze({status:'BCI_V3_SCRIPT_REVIEW_PREFLIGHT_ONLY',
     tenantId:a.tenantId,reviewerId:a.reviewerSubject,
     signedScriptMediaEvidenceId:evidenceId,...bound,
     mediaCount:pins.length,signatureVerified:true,reviewerAuthorized:true,
     durableApprovalRecorded:false,reservationGranted:false,
     providerSent:false,executionAllowed:false});
  }catch{return deny();}
 };
}
