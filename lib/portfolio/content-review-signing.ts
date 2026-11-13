import { contentCreativeReuseGrantBytes } from './content-creative-reuse-contract.ts';

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

export const DEMAND_REUSE_CHECKS = [
  'ORIGINAL_AND_EDITORIAL', 'LOGO_AND_CLAIMS', 'AI_DISCLOSURE', 'DEMAND_REVIEW_ONLY',
] as const;
const reuseId = /^[A-Za-z0-9][A-Za-z0-9:_-]{7,127}$/;
const tenantIdPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const proofPattern = /^content-instance-script-proof-[a-f0-9]{64}$/;
const denyReuse = (): never => { throw Error('DEMAND_REUSE_REVIEW_INCOMPLETE'); };

export async function signContentDemandReuse(
  key: ContentReviewerKey, envelope: Json, slot: number, original: Uint8Array,
  review: Readonly<{
    presetId: string; presetVersion: string; logoEvidence: 'NO_LOGO' | 'OFFICIAL_APPROVED';
    logoAssetVersionId: string | null;
    confirmedChecks: readonly string[];
  }>,
) {
  const { tenantId, instanceId, proofEnvelopeId, orderedMediaDigests } = envelope;
  const claimRefs = (envelope.copy as Json | undefined)?.claimEvidenceRefs;
  if (envelope.schemaVersion !== 3 || envelope.product !== 'content' ||
      !Array.isArray(envelope.automatedReviewFlags) || envelope.automatedReviewFlags.length !== 0 ||
      typeof tenantId !== 'string' || !tenantIdPattern.test(tenantId) ||
      typeof instanceId !== 'string' || !reuseId.test(instanceId) ||
      typeof proofEnvelopeId !== 'string' || !proofPattern.test(proofEnvelopeId) ||
      !Number.isInteger(slot) || slot < 1 || slot > 6 ||
      !Array.isArray(orderedMediaDigests) || orderedMediaDigests[slot - 1]?.slot !== slot ||
      !DEMAND_REUSE_CHECKS.every(check => review.confirmedChecks.includes(check)) ||
      !reuseId.test(key.keyId) || key.privateKey.extractable ||
      !reuseId.test(review.presetId) || !reuseId.test(review.presetVersion) ||
      !Array.isArray(claimRefs) || claimRefs.length !== 0 ||
      !(review.logoEvidence === 'NO_LOGO' ? review.logoAssetVersionId === null :
        review.logoEvidence === 'OFFICIAL_APPROVED' && typeof review.logoAssetVersionId === 'string' &&
        reuseId.test(review.logoAssetVersionId))) return denyReuse();
  if (original.byteLength < 32 || original.byteLength > 12 * 1024 * 1024 ||
      ![137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => original[index] === byte)) return denyReuse();
  const sha256 = await hash(original);
  if (sha256 !== orderedMediaDigests[slot - 1].sourceSha256) return denyReuse();
  const assetId = 'content-asset-' + await hash(JSON.stringify([tenantId, proofEnvelopeId, slot]));
  const creativeVersion = 'content-version-' + sha256;
  const now = Date.now();
  const approvedAt = new Date(now).toISOString();
  const approvalEvidenceId = 'content-demand-review-' + await hash(JSON.stringify([
    key.keyId, assetId, creativeVersion, approvedAt, nonce(),
  ]));
  const payload = {
    schemaVersion: 1, product: 'demand', purpose: 'CREATIVE_REVIEW', proofEnvelopeId, slot, approvedAt,
    expiresAt: new Date(now + 24 * 60 * 60 * 1000).toISOString(), logoAssetVersionId: review.logoAssetVersionId,
    creative: {
      aiDisclosure: 'REVIEWED', approvalEvidenceId, assetId, brandInstanceId: instanceId, bytes: original.byteLength,
      claimsEvidence: 'NO_CLAIMS', creativeVersion, editorialQa: 'APPROVED', logoEvidence: review.logoEvidence,
      mediaQa: 'PASSED', mime: 'image/png', presetId: review.presetId, presetVersion: review.presetVersion,
      sha256, status: 'APPROVED', tenantId,
    },
  };
  const signature = await crypto.subtle.sign('Ed25519', key.privateKey, contentCreativeReuseGrantBytes(key.keyId, payload));
  return { keyId: key.keyId, payload, signature: base64url(new Uint8Array(signature)) };
}
