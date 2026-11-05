/** DEV-only restricted approval ledger adapter. No HTTP, signer, or publisher.
 * Invoke ONLY after server-side Ed25519 V1+V2 verification of canonical
 * original PNG bytes, copy, complete destination and current reviewer JWT.
 * A SQL row is not proof of a human decision without that issuer boundary.
 */
import {createHash} from "node:crypto";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const SHA=/^[a-f0-9]{64}$/;
const F=["approvalId","tenantId","reviewerId","dispatchIntentId","bindingSha256",
 "approvedAt","expiresAt","signedReviewEvidenceId","originalMediaSha256",
 "signedDispatchIntentSha256","signedReviewReceipt","signedAdmissionReceipt",
 "signedAdmissionNonce"];
const V3=["scriptProofEnvelopeId","signedScriptMediaEvidenceId","orderedMediaManifestSha256","signedScriptReviewReceipt","scriptDispatchBindingSha256","originalMediaCount"];
const hash=x=>createHash("sha256").update(x).digest("hex");
const deny=()=>{throw Error("BCI_CONTENT_RESTRICTED_APPROVAL_DENIED");};
function pin(v,version=2){
 if(!v||typeof v!=="object"||Array.isArray(v)||
   ![Object.prototype,null].includes(Object.getPrototypeOf(v))||
   Reflect.ownKeys(v).length!==F.length+(version===3?V3.length:0))deny();
 const out={};
 for(const k of F){
  const d=Object.getOwnPropertyDescriptor(v,k);
  if(!d?.enumerable||!Object.hasOwn(d,"value"))deny();
  out[k]=d.value;
 }
 if(version===3){
  for(const k of V3){const d=Object.getOwnPropertyDescriptor(v,k);if(!d?.enumerable||!Object.hasOwn(d,"value"))deny();out[k]=d.value;}
  if(![out.scriptProofEnvelopeId,out.signedScriptMediaEvidenceId].every(x=>typeof x==="string"&&ID.test(x))||
    !SHA.test(out.orderedMediaManifestSha256)||!SHA.test(out.scriptDispatchBindingSha256)||
    !Number.isInteger(out.originalMediaCount)||out.originalMediaCount<2||out.originalMediaCount>6||
    typeof out.signedScriptReviewReceipt!=="string"||Buffer.byteLength(out.signedScriptReviewReceipt)<80||
    Buffer.byteLength(out.signedScriptReviewReceipt)>32768)deny();
 }
 if(![out.approvalId,out.dispatchIntentId,out.signedReviewEvidenceId].every(x=>typeof x==="string"&&ID.test(x))||
   ![out.tenantId,out.reviewerId].every(x=>typeof x==="string"&&UUID.test(x))||
   ![out.bindingSha256,out.originalMediaSha256,out.signedDispatchIntentSha256]
     .every(x=>typeof x==="string"&&SHA.test(x))||
   !/^[a-f0-9]{32,64}$/.test(out.signedAdmissionNonce)||
   ![out.signedReviewReceipt,out.signedAdmissionReceipt].every(x=>
     typeof x==="string"&&Buffer.byteLength(x)>=80&&Buffer.byteLength(x)<=32768)||
   ![out.approvedAt,out.expiresAt].every(x=>typeof x==="string"&&
     /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(x)&&
     Number.isFinite(Date.parse(x))&&new Date(x).toISOString()===x)||
   Date.parse(out.approvedAt)>=Date.parse(out.expiresAt)||
   Date.parse(out.expiresAt)-Date.parse(out.approvedAt)>86400000)deny();
 return Object.freeze({...out,reviewDigest:hash(out.signedReviewReceipt),
   admissionDigest:hash(out.signedAdmissionReceipt),proofVersion:version,...(version===3?{scriptReviewDigest:hash(out.signedScriptReviewReceipt)}:{})});
}
function exactRow(row,p){
 return row&&row.approvalId===p.approvalId&&row.tenantId===p.tenantId&&
  row.product==="content"&&row.dispatchIntentId===p.dispatchIntentId&&
  row.approvedBy===p.reviewerId&&row.bindingSha256===p.bindingSha256&&
  row.approvedAt instanceof Date&&row.approvedAt.toISOString()===p.approvedAt&&
  row.expiresAt instanceof Date&&row.expiresAt.toISOString()===p.expiresAt&&
  row.signedProofVersion===p.proofVersion&&row.signedReviewEvidenceId===p.signedReviewEvidenceId&&
  row.originalMediaSha256===p.originalMediaSha256&&row.originalMediaCount===(p.proofVersion===3?p.originalMediaCount:1)&&
  row.signedDispatchIntentSha256===p.signedDispatchIntentSha256&&
  row.reviewDigest===p.reviewDigest&&row.admissionDigest===p.admissionDigest&&
  row.signedAdmissionNonce===p.signedAdmissionNonce&&
  (p.proofVersion===2||row.scriptProofEnvelopeId===p.scriptProofEnvelopeId&&
   row.signedScriptMediaEvidenceId===p.signedScriptMediaEvidenceId&&
   row.orderedMediaManifestSha256===p.orderedMediaManifestSha256&&
   row.scriptReviewDigest===p.scriptReviewDigest&&
   row.scriptDispatchBindingSha256===p.scriptDispatchBindingSha256);
}
const selectSql="SELECT approval_id AS \"approvalId\",tenant_id::text AS \"tenantId\","+
 "product,dispatch_intent_id AS \"dispatchIntentId\",approved_by::text AS \"approvedBy\","+
 "binding_sha256 AS \"bindingSha256\",approved_at AS \"approvedAt\",expires_at AS \"expiresAt\",signed_proof_version AS \"signedProofVersion\","+
 "signed_review_evidence_id AS \"signedReviewEvidenceId\","+
 "original_media_sha256 AS \"originalMediaSha256\",original_media_count AS \"originalMediaCount\","+
 "signed_dispatch_intent_sha256 AS \"signedDispatchIntentSha256\","+
 "signed_review_receipt_sha256 AS \"reviewDigest\","+
 "signed_admission_receipt_sha256 AS \"admissionDigest\","+
 "signed_admission_nonce AS \"signedAdmissionNonce\",script_proof_envelope_id AS \"scriptProofEnvelopeId\",signed_script_media_evidence_id AS \"signedScriptMediaEvidenceId\",ordered_media_manifest_sha256 AS \"orderedMediaManifestSha256\",signed_script_review_receipt_sha256 AS \"scriptReviewDigest\",script_dispatch_binding_sha256 AS \"scriptDispatchBindingSha256\""+
 " FROM bci_dev.content_dispatch_approvals WHERE tenant_id=$1::uuid"+
 " AND product='content' AND dispatch_intent_id=$2::text AND approved_by=$3::uuid";
export function createBciContentRestrictedApprovalLedger({writeTransaction,readTransaction}){
 if(typeof writeTransaction!=="function"||typeof readTransaction!=="function")deny();
 async function operate(input,readOnly,version=2){
  const p=pin(input,version);
  try{
   return await (readOnly?readTransaction:writeTransaction)(async query=>{
    const r=await query("SELECT current_user AS \"role\",session_user AS \"sessionRole\","+
      "rolcanlogin AS \"canLogin\",rolbypassrls AS \"bypass\",rolinherit AS \"inherits\","+
      "rolsuper AS \"superuser\",rolcreaterole AS \"createRole\",rolcreatedb AS \"createDb\","+
      "(SELECT count(*)::integer FROM pg_auth_members WHERE member=pg_roles.oid) AS \"parents\","+
      "current_database() AS \"db\" FROM pg_roles WHERE rolname=current_user",[]);
    const role=r.rows[0];
    if(r.rows.length!==1||role?.role!=="bci_dev_content_approval_issuer"||
       role.sessionRole!=="bci_dev_content_approval_issuer"||
       role.canLogin!==true||role.bypass!==false||role.inherits!==false||
       role.superuser!==false||role.createRole!==false||role.createDb!==false||
       role.parents!==0||role.db!=="bros_intelligence_dev")deny();
    await query("SELECT set_config('bci.principal_id',$1,true),"+
      "set_config('bci.tenant_id',$2,true),set_config('bci.product','content',true)",
      [p.reviewerId,p.tenantId]);
    const a=await query("SELECT (SELECT count(*)::integer FROM bci_dev.tenant_memberships"+
      " WHERE principal_id=$1::uuid AND tenant_id=$2::uuid AND product='content'"+
      " AND active IS TRUE AND revoked_at IS NULL) AS \"members\","+
      "(SELECT count(*)::integer FROM bci_dev.content_reviewer_authorizations"+
      " WHERE principal_id=$1::uuid AND tenant_id=$2::uuid AND product='content'"+
      " AND revoked_at IS NULL AND authorized_at<=$3::timestamptz) AS \"reviewers\"",
      [p.reviewerId,p.tenantId,p.approvedAt]);
    // The signed review time is historical evidence, not current authorization.
    // Enforce expiry and revocation at the actual restricted transaction boundary,
    // including replay/readback, rather than trusting a prior issuer preflight.
    const clock=await query("SELECT clock_timestamp() AS \"now\"",[]);
    const current=clock.rows[0]?.now;
    if(clock.rows.length!==1||!(current instanceof Date)||
       current.getTime()>=Date.parse(p.expiresAt)||
       current.getTime()<Date.parse(p.approvedAt)||
       a.rows.length!==1||a.rows[0].members!==1||a.rows[0].reviewers!==1)deny();
    if(!readOnly){
     const v3=p.proofVersion===3;
     const sql="INSERT INTO bci_dev.content_dispatch_approvals ("+
      "approval_id,tenant_id,product,dispatch_intent_id,approved_by,binding_sha256,"+
      "approved_at,expires_at,signed_proof_version,signed_review_evidence_id,"+
      "original_media_sha256,original_media_count,signed_dispatch_intent_sha256,"+
      "signed_review_receipt,signed_admission_receipt,signed_review_receipt_sha256,"+
      "signed_admission_receipt_sha256,signed_admission_nonce"+
      (v3?",script_proof_envelope_id,signed_script_media_evidence_id,ordered_media_manifest_sha256,"+
       "signed_script_review_receipt,signed_script_review_receipt_sha256,script_dispatch_binding_sha256":"")+") "+
      "VALUES ($1::text,$2::uuid,'content',$3::text,$4::uuid,$5::text,"+
      "$6::timestamptz,$7::timestamptz,$8::integer,$9::text,$10::text,$11::integer,$12::text,"+
      "$13::text,$14::text,$15::text,$16::text,$17::text"+
      (v3?",$18::text,$19::text,$20::text,$21::text,$22::text,$23::text":"")+") "+
      "ON CONFLICT (tenant_id,product,dispatch_intent_id) DO NOTHING RETURNING approval_id";
     const params=[p.approvalId,p.tenantId,p.dispatchIntentId,
       p.reviewerId,p.bindingSha256,p.approvedAt,p.expiresAt,p.proofVersion,
       p.signedReviewEvidenceId,p.originalMediaSha256,v3?p.originalMediaCount:1,
       p.signedDispatchIntentSha256,p.signedReviewReceipt,p.signedAdmissionReceipt,
       p.reviewDigest,p.admissionDigest,p.signedAdmissionNonce];
     if(v3)params.push(p.scriptProofEnvelopeId,p.signedScriptMediaEvidenceId,
       p.orderedMediaManifestSha256,p.signedScriptReviewReceipt,p.scriptReviewDigest,
       p.scriptDispatchBindingSha256);
     const inserted=await query(sql,params);
     // V3 approval admission is one-shot: a replay must not be accepted as
     // a successful append even when every signed field matches an old row.
     // Preserve V2's existing idempotent reconciliation contract.
     if(inserted.rows.length>1||(v3&&inserted.rows.length!==1)||
       inserted.rows.length===1&&inserted.rows[0].approval_id!==p.approvalId)deny();
    }
    // A slow transaction can cross the signed expiry after its initial check.
    // Fail closed before returning acceptance, including on separate readback.
    const finalClock=await query("SELECT clock_timestamp() AS \"now\"",[]);
    const finalNow=finalClock.rows[0]?.now;
    if(finalClock.rows.length!==1||!(finalNow instanceof Date)||
       finalNow.getTime()>=Date.parse(p.expiresAt)||
       finalNow.getTime()<Date.parse(p.approvedAt))deny();
    const found=await query(selectSql,[p.tenantId,p.dispatchIntentId,p.reviewerId]);
    if(found.rows.length!==1||!exactRow(found.rows[0],p))deny();
    // Readback itself can be slow: validate expiry after the last database read.
    const readbackClock=await query("SELECT clock_timestamp() AS \"now\"",[]);
    const readbackNow=readbackClock.rows[0]?.now;
    if(readbackClock.rows.length!==1||!(readbackNow instanceof Date)||
       readbackNow.getTime()>=Date.parse(p.expiresAt)||
       readbackNow.getTime()<Date.parse(p.approvedAt))deny();
    // Recheck current authorization after the potentially slow insert/readback.
    // A reviewer revoked mid-transaction must not receive acceptance.
    const latestAuth=await query("SELECT (SELECT count(*)::integer FROM bci_dev.tenant_memberships"+
      " WHERE principal_id=$1::uuid AND tenant_id=$2::uuid AND product='content'"+
      " AND active IS TRUE AND revoked_at IS NULL) AS \"members\","+ 
      "(SELECT count(*)::integer FROM bci_dev.content_reviewer_authorizations"+
      " WHERE principal_id=$1::uuid AND tenant_id=$2::uuid AND product='content'"+
      " AND revoked_at IS NULL AND authorized_at<=$3::timestamptz) AS \"reviewers\"",
      [p.reviewerId,p.tenantId,p.approvedAt]);
    if(latestAuth.rows.length!==1||latestAuth.rows[0].members!==1||
       latestAuth.rows[0].reviewers!==1)deny();
    return Object.freeze({status:readOnly?"committed_readback":p.proofVersion===3?"append_committed":"append_reconciled",
      approvalId:p.approvalId,providerSent:false,executionAllowed:false});
   });
  }catch{return deny();}
 }
 return Object.freeze({append:p=>operate(p,false),readback:p=>operate(p,true),
  appendV3:p=>operate(p,false,3),readbackV3:p=>operate(p,true,3)});
}
