// CONTENT-only cryptographic receipt preflight. A valid signature proves that a
// configured key signed the payload; it does NOT prove reviewer login, role,
// tenant membership, visual QA, durable approval, or permission to publish.
// The caller MUST derive handoff from fresh original media bytes on the server.
import {createHash, verify, KeyObject} from 'node:crypto';

const ID=/^[A-Za-z0-9][A-Za-z0-9_.|:-]{1,127}$/;
const SHA=/^[a-f0-9]{64}$/;
const TIME=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const payloadKeys=['schemaVersion','product','tenantId','instanceId','planId','mediaSetId',
  'approvalRequestId','reviewPacketId','handoffId','reviewerSubject','reviewerProvider',
  'reviewedAt','expiresAt','nonce','decision','checkResults'];
const receiptKeys=['schemaVersion','keyId','payload','signature'];
const checkKeys=['check','passed'];
function exact(obj,keys,label){
  if(!obj||typeof obj!=='object'||Array.isArray(obj)||
      ![Object.prototype,null].includes(Object.getPrototypeOf(obj))||
      Reflect.ownKeys(obj).length!==keys.length||
      Reflect.ownKeys(obj).some(k=>typeof k!=='string'||!keys.includes(k)||
        !Object.getOwnPropertyDescriptor(obj,k)?.enumerable||
        !Object.hasOwn(Object.getOwnPropertyDescriptor(obj,k),'value')))
    throw Error('INVALID_CONTENT_SIGNED_'+label);
}
function own(obj,key){
  if(!obj||typeof obj!=='object'||Array.isArray(obj)||
      ![Object.prototype,null].includes(Object.getPrototypeOf(obj)))
    throw Error('INVALID_CONTENT_REVIEW_HANDOFF');
  const d=Object.getOwnPropertyDescriptor(obj,key);
  if(!d?.enumerable||!Object.hasOwn(d,'value'))throw Error('INVALID_CONTENT_REVIEW_HANDOFF');
  return d.value;
}
function validTime(value){return typeof value==='string'&&TIME.test(value)&&
  Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;}
function signatureBytes(payload){
  // Domain-separated fixed-order canonical tuple: JSON object key insertion order
  // cannot change the signed meaning of the decision.
  return Buffer.from('BROS_CONTENT_SIGNED_REVIEW_V1\n'+JSON.stringify(payloadKeys.map(k=>payload[k])),'utf8');
}
export function contentSignedReviewSigningBytes(payload){
  exact(payload,payloadKeys,'REVIEW_PAYLOAD');
  return signatureBytes(payload);
}
export function verifyContentSignedEditorialDecision(handoff,receipt,trustedPublicKeys,now=Date.now()){
  exact(receipt,receiptKeys,'RECEIPT');
  if(receipt.schemaVersion!==1||!ID.test(receipt.keyId)||
      typeof receipt.signature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(receipt.signature))
    throw Error('INVALID_CONTENT_SIGNED_RECEIPT_FORMAT');
  exact(receipt.payload,payloadKeys,'REVIEW_PAYLOAD');
  const p=receipt.payload;
  if(p.schemaVersion!==1||p.product!=='content'||
      !['tenantId','instanceId','reviewerSubject','reviewerProvider'].every(k=>
        typeof p[k]==='string'&&ID.test(p[k]))||
      !['planId','mediaSetId','approvalRequestId','reviewPacketId','handoffId'].every(k=>
        typeof p[k]==='string'&&p[k].length<=128&&p[k].startsWith('content-')&&
        SHA.test(p[k].slice(p[k].lastIndexOf('-')+1)))||
      !/^[a-f0-9]{32,64}$/.test(p.nonce)||
      !['APPROVE','REJECT'].includes(p.decision)||
      !validTime(p.reviewedAt)||!validTime(p.expiresAt))
    throw Error('INVALID_CONTENT_SIGNED_REVIEW_FIELDS');
  if(!Number.isSafeInteger(now))throw Error('INVALID_CONTENT_REVIEW_CLOCK');
  const start=Date.parse(p.reviewedAt),end=Date.parse(p.expiresAt);
  if(start>now+5*60_000||end<=now||end<=start||end-start>24*60*60_000)
    throw Error('CONTENT_SIGNED_REVIEW_EXPIRED_OR_INVALID_WINDOW');
  for(const key of ['tenantId','instanceId','planId','mediaSetId','approvalRequestId',
    'reviewPacketId','handoffId']){
    if(p[key]!==own(handoff,key))throw Error('CONTENT_SIGNED_REVIEW_SCOPE_MISMATCH');
  }
  if(own(handoff,'product')!=='content'||
      own(handoff,'status')!=='LOCAL_MEDIA_EDITORIAL_REVIEW_PENDING'||
      own(handoff,'approvalGranted')!==false||own(handoff,'executionAllowed')!==false)
    throw Error('CONTENT_SIGNED_REVIEW_INVALID_HANDOFF_STATE');
  const checks=own(handoff,'requiredHumanChecks');
  if(!Array.isArray(checks)||!Array.isArray(p.checkResults)||
      p.checkResults.length!==checks.length||
      Reflect.ownKeys(p.checkResults).length!==checks.length+1||
      !checks.every((check,i)=>{
        const d=Object.getOwnPropertyDescriptor(p.checkResults,String(i));
        if(!d?.enumerable||!Object.hasOwn(d,'value'))return false;
        const entry=d.value;
        exact(entry,checkKeys,'CHECK');
        return entry.check===check&&typeof entry.passed==='boolean';
      })||p.decision==='APPROVE'&&p.checkResults.some(x=>x.passed!==true))
    throw Error('CONTENT_SIGNED_REVIEW_CHECKS_UNRESOLVED');
  if(!(trustedPublicKeys instanceof Map))throw Error('CONTENT_SIGNED_REVIEW_TRUST_ANCHOR_MISSING');
  const key=trustedPublicKeys.get(receipt.keyId);
  if(!(key instanceof KeyObject)||key.type!=='public'||key.asymmetricKeyType!=='ed25519')
    throw Error('CONTENT_SIGNED_REVIEW_TRUST_ANCHOR_MISSING');
  const signature=Buffer.from(receipt.signature,'base64url');
  if(signature.length!==64||signature.toString('base64url')!==receipt.signature||
      !verify(null,signatureBytes(p),key,signature))
    throw Error('CONTENT_SIGNED_REVIEW_SIGNATURE_INVALID');
  const signedReviewEvidenceId='content-signed-review-'+createHash('sha256')
    .update(signatureBytes(p)).update(signature).digest('hex');
  return Object.freeze({schemaVersion:1,product:'content',tenantId:p.tenantId,
    instanceId:p.instanceId,planId:p.planId,mediaSetId:p.mediaSetId,
    approvalRequestId:p.approvalRequestId,reviewPacketId:p.reviewPacketId,
    handoffId:p.handoffId,signedReviewEvidenceId,
    signedDecision:p.decision,status:'SIGNED_REVIEW_EVIDENCE_ONLY',
    signatureVerified:true,reviewerAuthenticated:false,
    reviewerRoleVerified:false,tenantMembershipVerified:false,
    visualEditorialQaVerified:false,approvalGranted:false,
    durableApprovalRecorded:false,atomicReservationVerified:false,
    providerSentVerified:false,measurementVerified:false,
    sharedBciAuditVerified:false,executionAllowed:false,customerSaasReady:false});
}
