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
const hash=x=>createHash("sha256").update(x).digest("hex");
const deny=()=>{throw Error("BCI_CONTENT_RESTRICTED_APPROVAL_DENIED");};
function pin(v){
 if(!v||typeof v!=="object"||Array.isArray(v)||
   ![Object.prototype,null].includes(Object.getPrototypeOf(v))||
   Reflect.ownKeys(v).length!==F.length)deny();
 const out={};
 for(const k of F){
  const d=Object.getOwnPropertyDescriptor(v,k);
  if(!d?.enumerable||!Object.hasOwn(d,"value"))deny();
  out[k]=d.value;
 }
 if(!ID.test(out.approvalId)||!UUID.test(out.tenantId)||
   !UUID.test(out.reviewerId)||!ID.test(out.dispatchIntentId)||
   !ID.test(out.signedReviewEvidenceId)||
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
   admissionDigest:hash(out.signedAdmissionReceipt)});
}
function exactRow(row,p){
 return row&&row.approvalId===p.approvalId&&row.tenantId===p.tenantId&&
  row.product==="content"&&row.dispatchIntentId===p.dispatchIntentId&&
  row.approvedBy===p.reviewerId&&row.bindingSha256===p.bindingSha256&&
  row.approvedAt instanceof Date&&row.approvedAt.toISOString()===p.approvedAt&&
  row.expiresAt instanceof Date&&row.expiresAt.toISOString()===p.expiresAt&&
  row.signedProofVersion===2&&row.signedReviewEvidenceId===p.signedReviewEvidenceId&&
  row.originalMediaSha256===p.originalMediaSha256&&row.originalMediaCount===1&&
  row.signedDispatchIntentSha256===p.signedDispatchIntentSha256&&
  row.reviewDigest===p.reviewDigest&&row.admissionDigest===p.admissionDigest&&
  row.signedAdmissionNonce===p.signedAdmissionNonce;
}
const selectSql="SELECT approval_id AS \"approvalId\",tenant_id::text AS \"tenantId\","+
 "product,dispatch_intent_id AS \"dispatchIntentId\",approved_by::text AS \"approvedBy\","+
 "binding_sha256 AS \"bindingSha256\",approved_at AS \"approvedAt\",expires_at AS \"expiresAt\",signed_proof_version AS \"signedProofVersion\","+
 "signed_review_evidence_id AS \"signedReviewEvidenceId\","+
 "original_media_sha256 AS \"originalMediaSha256\",original_media_count AS \"originalMediaCount\","+
 "signed_dispatch_intent_sha256 AS \"signedDispatchIntentSha256\","+
 "signed_review_receipt_sha256 AS \"reviewDigest\","+
 "signed_admission_receipt_sha256 AS \"admissionDigest\","+
 "signed_admission_nonce AS \"signedAdmissionNonce\""+
 " FROM bci_dev.content_dispatch_approvals WHERE tenant_id=$1::uuid"+
 " AND product='content' AND dispatch_intent_id=$2::text AND approved_by=$3::uuid";
export function createBciContentRestrictedApprovalLedger({writeTransaction,readTransaction}){
 if(typeof writeTransaction!=="function"||typeof readTransaction!=="function")deny();
 async function operate(input,readOnly){
  const p=pin(input);
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
    if(a.rows.length!==1||a.rows[0].members!==1||a.rows[0].reviewers!==1)deny();
    if(!readOnly){
     const sql="INSERT INTO bci_dev.content_dispatch_approvals ("+
      "approval_id,tenant_id,product,dispatch_intent_id,approved_by,binding_sha256,"+
      "approved_at,expires_at,signed_proof_version,signed_review_evidence_id,"+
      "original_media_sha256,original_media_count,signed_dispatch_intent_sha256,"+
      "signed_review_receipt,signed_admission_receipt,signed_review_receipt_sha256,"+
      "signed_admission_receipt_sha256,signed_admission_nonce) "+
      "VALUES ($1::text,$2::uuid,'content',$3::text,$4::uuid,$5::text,"+
      "$6::timestamptz,$7::timestamptz,2,$8::text,$9::text,1,$10::text,"+
      "$11::text,$12::text,$13::text,$14::text,$15::text) "+
      "ON CONFLICT (tenant_id,product,dispatch_intent_id) DO NOTHING RETURNING approval_id";
     const inserted=await query(sql,[p.approvalId,p.tenantId,p.dispatchIntentId,
       p.reviewerId,p.bindingSha256,p.approvedAt,p.expiresAt,
       p.signedReviewEvidenceId,p.originalMediaSha256,p.signedDispatchIntentSha256,
       p.signedReviewReceipt,p.signedAdmissionReceipt,p.reviewDigest,
       p.admissionDigest,p.signedAdmissionNonce]);
     if(inserted.rows.length>1||inserted.rows.length===1&&
       inserted.rows[0].approval_id!==p.approvalId)deny();
    }
    const found=await query(selectSql,[p.tenantId,p.dispatchIntentId,p.reviewerId]);
    if(found.rows.length!==1||!exactRow(found.rows[0],p))deny();
    return Object.freeze({status:readOnly?"committed_readback":"append_reconciled",
      approvalId:p.approvalId,providerSent:false,executionAllowed:false});
   });
  }catch{return deny();}
 }
 return Object.freeze({append:p=>operate(p,false),readback:p=>operate(p,true)});
}
