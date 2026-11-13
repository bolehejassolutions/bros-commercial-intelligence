/** Browser-owned Ed25519 key; the private key never enters a request. The
 * server independently verifies registered public keys, JWT and reviewer RLS.
 */
const EDITORIAL=['schemaVersion','product','tenantId','instanceId','planId','mediaSetId',
  'approvalRequestId','reviewPacketId','handoffId','reviewerSubject','reviewerProvider',
  'reviewedAt','expiresAt','nonce','decision','checkResults'];
const SCRIPT=['schemaVersion','product','proofEnvelopeId','tenantId','instanceId','planId',
  'reviewPacketId','scriptIntentId','copySha256','channelService','channelId','reviewerSubject',
  'reviewerProvider','reviewedAt','expiresAt','nonce','decision','scriptCheckResults'];
const DISPATCH=['schemaVersion','product','tenantId','reviewerSubject','reviewerProvider',
  'proofEnvelopeId','scriptIntentId','signedScriptMediaEvidenceId','orderedMediaManifestSha256',
  'originalMediaCount','copySha256','channelService','channelId','dispatchIntentId','bindingSha256',
  'signedDispatchIntentSha256','reviewedAt','expiresAt','nonce'];
export const SCRIPT_REVIEW_CHECKS=[
  'VERIFY_SCRIPT_SHOTS_MATCH_RENDERED_MEDIA_SEMANTICALLY',
  'VERIFY_RESOURCE_MAPPING_INPUT_ACTION_OUTPUT_AND_PAYOFF',
  'VERIFY_SCRIPT_COPY_CLAIMS_RIGHTS_AND_DISCLOSURE'];
const text=new TextEncoder();
const hex=(b:Uint8Array)=>Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');
const hash=async(input:string|Uint8Array)=>hex(new Uint8Array(await crypto.subtle.digest('SHA-256',
  typeof input==='string'?text.encode(input):new Uint8Array(input))));
const base64=(b:Uint8Array)=>btoa(Array.from(b,x=>String.fromCharCode(x)).join(''));
const base64url=(b:Uint8Array)=>base64(b).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
const nonce=()=>hex(crypto.getRandomValues(new Uint8Array(24)));
type Json=Record<string,unknown>;
export type ContentReviewerKey=Readonly<{keyId:string;publicKeyPem:string;privateKey:CryptoKey;publicKey:CryptoKey}>;
export async function createContentReviewerKey():Promise<ContentReviewerKey>{
  const pair=await crypto.subtle.generateKey({name:'Ed25519'},false,['sign','verify']) as CryptoKeyPair;
  const raw=new Uint8Array(await crypto.subtle.exportKey('spki',pair.publicKey));
  const id=(await hash(raw)).slice(0,24),encoded=base64(raw);
  return {keyId:'content-owner-'+id,publicKeyPem:'-----BEGIN PUBLIC KEY-----\n'+
    encoded.match(/.{1,64}/g)!.join('\n')+'\n-----END PUBLIC KEY-----\n',...pair};
}
async function signReceipt(key:ContentReviewerKey,version:number,payload:Json,fields:string[],domain:string){
  const bytes=text.encode(domain+'\n'+JSON.stringify(fields.map(k=>payload[k])));
  const sig=new Uint8Array(await crypto.subtle.sign('Ed25519',key.privateKey,bytes));
  return {receipt:{schemaVersion:version,keyId:key.keyId,payload,signature:base64url(sig)},bytes,sig};
}
/** Invoke only after the operator has reviewed every original, script, claim
 * and destination and explicitly checked all required criteria. */
export async function signContentReviewDecision(key:ContentReviewerKey,envelope:Json,handoff:Json,
  reviewerSubject:string,confirmedChecks:readonly string[]){
  if(envelope.schemaVersion!==3||envelope.product!=='content'||
     !Array.isArray(envelope.automatedReviewFlags)||envelope.automatedReviewFlags.length!==0||
     !Array.isArray(handoff.requiredHumanChecks)||handoff.requiredHumanChecks.length!==6||
     handoff.reviewPacketId!==envelope.reviewPacketId||
     ![...handoff.requiredHumanChecks,...SCRIPT_REVIEW_CHECKS].every(x=>confirmedChecks.includes(String(x))))throw Error('REVIEW_INCOMPLETE');
  const destination=envelope.destination as Json;
  const reviewedAt=new Date().toISOString(),expiresAt=new Date(Date.now()+3600000).toISOString();
  const imagePayload={schemaVersion:1,product:'content',tenantId:envelope.tenantId,
    instanceId:envelope.instanceId,planId:envelope.planId,mediaSetId:envelope.mediaSetId,
    approvalRequestId:envelope.approvalRequestId,reviewPacketId:envelope.reviewPacketId,
    handoffId:handoff.handoffId,reviewerSubject,reviewerProvider:'neon-auth',reviewedAt,expiresAt,
    nonce:nonce(),decision:'APPROVE',checkResults:handoff.requiredHumanChecks.map(check=>({check,passed:true}))};
  const editorial=await signReceipt(key,1,imagePayload,EDITORIAL,'BROS_CONTENT_SIGNED_REVIEW_V1');
  // The script review has its own actual time and nonce, after image review.
  while(Date.now()<=Date.parse(reviewedAt))await new Promise(resolve=>setTimeout(resolve,1));
  const scriptTime=new Date().toISOString();
  const scriptPayload={schemaVersion:1,product:'content',proofEnvelopeId:envelope.proofEnvelopeId,
    tenantId:envelope.tenantId,instanceId:envelope.instanceId,planId:envelope.planId,
    reviewPacketId:envelope.reviewPacketId,scriptIntentId:envelope.scriptIntentId,
    copySha256:envelope.copySha256,channelService:destination.channelService,
    channelId:destination.channelId,reviewerSubject,reviewerProvider:'neon-auth',
    reviewedAt:scriptTime,expiresAt,nonce:nonce(),decision:'APPROVE',
    scriptCheckResults:SCRIPT_REVIEW_CHECKS.map(check=>({check,passed:true}))};
  const script=await signReceipt(key,1,scriptPayload,SCRIPT,'BROS_CONTENT_INSTANCE_SCRIPT_SIGNED_REVIEW_V1');
  const signedBytes=new Uint8Array(script.bytes.length+script.sig.length);
  signedBytes.set(script.bytes);signedBytes.set(script.sig,script.bytes.length);
  const signedScriptMediaEvidenceId='content-instance-script-signed-'+await hash(signedBytes);
  const images=envelope.orderedMediaDigests as {slot:number;sourceSha256:string}[];
  const orderedMediaManifestSha256=await hash('BCI_CONTENT_ORDERED_MEDIA_V3\n'+JSON.stringify(images.map(x=>[x.slot,x.sourceSha256])));
  // Preserve the existing V3 issuer's literal backslash-n binding domains.
  const bindingSha256=await hash('BCI_CONTENT_SCRIPT_DISPATCH_BINDING_V3\\n'+JSON.stringify([
    envelope.proofEnvelopeId,envelope.scriptIntentId,signedScriptMediaEvidenceId,
    orderedMediaManifestSha256,images.length,envelope.copySha256,destination.channelService,
    destination.channelId,envelope.tenantId,reviewerSubject]));
  const dispatchIntentId='content-dispatch-'+await hash(JSON.stringify([envelope.proofEnvelopeId,nonce()]));
  const signedDispatchIntentSha256=await hash('BCI_CONTENT_SCRIPT_DISPATCH_INTENT_V3\\n'+JSON.stringify([dispatchIntentId,bindingSha256]));
  const dispatch=await signReceipt(key,3,{schemaVersion:3,product:'content',tenantId:envelope.tenantId,
    reviewerSubject,reviewerProvider:'neon-auth',proofEnvelopeId:envelope.proofEnvelopeId,
    scriptIntentId:envelope.scriptIntentId,signedScriptMediaEvidenceId,orderedMediaManifestSha256,
    originalMediaCount:images.length,copySha256:envelope.copySha256,
    channelService:destination.channelService,channelId:destination.channelId,dispatchIntentId,
    bindingSha256,signedDispatchIntentSha256,reviewedAt:scriptTime,expiresAt,nonce:nonce()},
    DISPATCH,'BROS_CONTENT_COMPLETE_DISPATCH_ADMISSION_V3');
  return {editorial:editorial.receipt,script:script.receipt,dispatch:dispatch.receipt};
}
