import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createBciContentRestrictedApprovalLedger} from "../lib/bci/neon-content-approval-atomic.mjs";
const sql=readFileSync(new URL("../neon/migrations/0023_dev_content_approval_issuer_rls.sql",import.meta.url),"utf8");
const uuid="11111111-1111-4111-8111-111111111111",tenant="22222222-2222-4222-8222-222222222222";
const p={approvalId:"content-approved-1",tenantId:tenant,reviewerId:uuid,
 dispatchIntentId:"content-intent-1",bindingSha256:"a".repeat(64),
 approvedAt:"2026-11-03T01:00:00.000Z",expiresAt:"2026-11-03T02:00:00.000Z",
 signedReviewEvidenceId:"content-signed-review-1",originalMediaSha256:"b".repeat(64),
 signedDispatchIntentSha256:"c".repeat(64),
 signedReviewReceipt:"r".repeat(100),signedAdmissionReceipt:"s".repeat(100),
 signedAdmissionNonce:"d".repeat(32)};
const role={role:"bci_dev_content_approval_issuer",sessionRole:"bci_dev_content_approval_issuer",
 canLogin:true,bypass:false,inherits:false,superuser:false,createRole:false,
 createDb:false,parents:0,db:"bros_intelligence_dev"};
const hash=async x=>(await import("node:crypto")).createHash("sha256").update(x).digest("hex");
async function harness(opts={}){
 const calls=[],digestA=await hash(p.signedReviewReceipt),digestB=await hash(p.signedAdmissionReceipt);
 let clockReads=0, authReads=0;
 const row={approvalId:p.approvalId,tenantId:tenant,product:"content",
 dispatchIntentId:p.dispatchIntentId,approvedBy:uuid,bindingSha256:p.bindingSha256,
 approvedAt:new Date(p.approvedAt),expiresAt:new Date(p.expiresAt),
 signedProofVersion:2,signedReviewEvidenceId:p.signedReviewEvidenceId,
 originalMediaSha256:p.originalMediaSha256,originalMediaCount:1,
 signedDispatchIntentSha256:p.signedDispatchIntentSha256,
 reviewDigest:digestA,admissionDigest:digestB,signedAdmissionNonce:p.signedAdmissionNonce};
 const tx=async fn=>fn(async(q,params)=>{
  calls.push({q,params});
  if(q.includes('AS "sessionRole"'))return {rows:[opts.role??role]};
  if(q.includes('AS "members"')){const n=authReads++;return {rows:[{members:opts.authSequence?.[n]?.members??opts.members??1,reviewers:opts.authSequence?.[n]?.reviewers??opts.reviewers??1}]};}
  if(q.includes('clock_timestamp() AS "now"'))return {rows:[{now:opts.clockSequence?.[clockReads++]??opts.clock??new Date("2026-11-03T01:30:00.000Z")}]};
  if(q.startsWith("INSERT"))return {rows:[{approval_id:p.approvalId}]};
  if(q.startsWith("SELECT approval_id"))return {rows:[opts.row??row]};
  return {rows:[{}]};
 });
 return {ledger:createBciContentRestrictedApprovalLedger({writeTransaction:tx,readTransaction:tx}),calls};
}
test("migration is DEV-only, NOLOGIN and never auto-authorizes a human reviewer",()=>{
 assert.match(sql,/CREATE ROLE bci_dev_content_approval_issuer NOLOGIN NOINHERIT NOBYPASSRLS/);
 assert.match(sql,/relrowsecurity AND relforcerowsecurity/);
 assert.match(sql,/CREATE POLICY dev_content_issuer_approval_insert/);
 assert.match(sql,/content_reviewer_authorizations a/);
 assert.match(sql,/a\.authorized_at<=approved_at/);
 assert.doesNotMatch(sql,/\.tenant_id=tenant_id/);
 assert.match(sql,/signed_proof_version=2 AND original_media_count=1/);
 assert.match(sql,/signed_review_receipt.*SELECT/);
 assert.doesNotMatch(sql,/GRANT (?:UPDATE|DELETE|TRUNCATE|CREATE) /);
 assert.doesNotMatch(sql,/PASSWORD\s+'/);
});
test("restricted append and separate readback bind role, current reviewer and exact proof digests",async()=>{
 const h=await harness();const out=await h.ledger.append(p);
 assert.equal(out.status,"append_reconciled");assert.equal(out.providerSent,false);
 assert.equal((await h.ledger.readback(p)).status,"committed_readback");
 assert.equal(h.calls.filter(x=>x.q.startsWith("INSERT")).length,1);
 assert.match(h.calls.find(x=>x.q.startsWith("INSERT")).q,/ON CONFLICT \(tenant_id,product,dispatch_intent_id\) DO NOTHING/);
 assert.match(h.calls.find(x=>x.q.includes('AS "members"')).q,/revoked_at IS NULL/);
 assert.match(h.calls.find(x=>x.q.includes('AS "members"')).q,/authorized_at<=\$3::timestamptz/);
 assert.equal(h.calls.some(x=>x.q.includes("set_config('bci.principal_id'")),true);
});
test("admin/SET ROLE, revoked reviewer, foreign binding and mismatched readback deny",async()=>{
 for(const options of [{role:{...role,sessionRole:"BROS"}},{role:{...role,bypass:true}},
  {members:0},{reviewers:0},{row:{}}]){
  const h=await harness(options);
  await assert.rejects(h.ledger.append(p),/BCI_CONTENT_RESTRICTED_APPROVAL_DENIED/);
 }
 const h=await harness();
 for(const v of [{...p,product:"content"},{...p,tenantId:"foreign"},
  {...p,originalMediaSha256:"B".repeat(64)},
  {...p,signedAdmissionReceipt:"too-short"}]){
  await assert.rejects(h.ledger.append(v),/BCI_CONTENT_RESTRICTED_APPROVAL_DENIED/);
 }
});

test("restricted ledger denies expired or not-yet-effective approvals on append and replay",async()=>{
 for(const clock of ["2026-11-03T02:00:00.000Z","2026-11-03T00:59:59.000Z"]){
  const h=await harness({clock:new Date(clock)});
  await assert.rejects(h.ledger.append(p),/BCI_CONTENT_RESTRICTED_APPROVAL_DENIED/);
  await assert.rejects(h.ledger.readback(p),/BCI_CONTENT_RESTRICTED_APPROVAL_DENIED/);
  assert.equal(h.calls.some(x=>x.q.startsWith("INSERT")),false);
 }
});

const v3={...p,scriptProofEnvelopeId:"script-proof-1",
 signedScriptMediaEvidenceId:"script-media-1",
 orderedMediaManifestSha256:"e".repeat(64),
 signedScriptReviewReceipt:"t".repeat(100),
 scriptDispatchBindingSha256:"f".repeat(64),originalMediaCount:3};
test("V3 restricted append binds all script fields and independently reads exact committed proof",async()=>{
 const scriptReviewDigest=await hash(v3.signedScriptReviewReceipt);
 const row={approvalId:p.approvalId,tenantId:tenant,product:"content",
  dispatchIntentId:p.dispatchIntentId,approvedBy:uuid,bindingSha256:p.bindingSha256,
  approvedAt:new Date(p.approvedAt),expiresAt:new Date(p.expiresAt),
  signedProofVersion:3,signedReviewEvidenceId:p.signedReviewEvidenceId,
  originalMediaSha256:p.originalMediaSha256,originalMediaCount:3,
  signedDispatchIntentSha256:p.signedDispatchIntentSha256,
  reviewDigest:await hash(p.signedReviewReceipt),
  admissionDigest:await hash(p.signedAdmissionReceipt),
  signedAdmissionNonce:p.signedAdmissionNonce,
  scriptProofEnvelopeId:v3.scriptProofEnvelopeId,
  signedScriptMediaEvidenceId:v3.signedScriptMediaEvidenceId,
  orderedMediaManifestSha256:v3.orderedMediaManifestSha256,
  scriptReviewDigest,scriptDispatchBindingSha256:v3.scriptDispatchBindingSha256};
 const h=await harness({row});
 assert.equal((await h.ledger.appendV3(v3)).status,"append_committed");
 assert.equal((await h.ledger.readbackV3(v3)).status,"committed_readback");
 const insert=h.calls.find(x=>x.q.startsWith("INSERT"));
 assert.match(insert.q,/signed_script_review_receipt_sha256/);
 assert.equal(insert.params.length,23);
 assert.equal(insert.params[7],3);
 assert.equal(insert.params[10],3);
 assert.equal(insert.params[21],scriptReviewDigest);
 for(const changed of [
  {...row,orderedMediaManifestSha256:"0".repeat(64)},
  {...row,scriptReviewDigest:"0".repeat(64)},
  {...row,originalMediaCount:2},
  {...row,signedProofVersion:2}]){
  const bad=await harness({row:changed});
  await assert.rejects(bad.ledger.readbackV3(v3),/BCI_CONTENT_RESTRICTED_APPROVAL_DENIED/);
 }
 const malformed=await harness({row});
 await assert.rejects(malformed.ledger.appendV3({...v3,originalMediaCount:1}),
  /BCI_CONTENT_RESTRICTED_APPROVAL_DENIED/);
 await assert.rejects(malformed.ledger.appendV3({...v3,scriptProofEnvelopeId:""}),
  /BCI_CONTENT_RESTRICTED_APPROVAL_DENIED/);
});


test("V3 duplicate conflict is rejected before readback, while V2 retains idempotent reconciliation",async()=>{
 const scriptReviewDigest=await hash(v3.signedScriptReviewReceipt);
 const row={approvalId:p.approvalId,tenantId:tenant,product:"content",
  dispatchIntentId:p.dispatchIntentId,approvedBy:uuid,bindingSha256:p.bindingSha256,
  approvedAt:new Date(p.approvedAt),expiresAt:new Date(p.expiresAt),
  signedProofVersion:3,signedReviewEvidenceId:p.signedReviewEvidenceId,
  originalMediaSha256:p.originalMediaSha256,originalMediaCount:3,
  signedDispatchIntentSha256:p.signedDispatchIntentSha256,
  reviewDigest:await hash(p.signedReviewReceipt),admissionDigest:await hash(p.signedAdmissionReceipt),
  signedAdmissionNonce:p.signedAdmissionNonce,
  scriptProofEnvelopeId:v3.scriptProofEnvelopeId,
  signedScriptMediaEvidenceId:v3.signedScriptMediaEvidenceId,
  orderedMediaManifestSha256:v3.orderedMediaManifestSha256,
  scriptReviewDigest,scriptDispatchBindingSha256:v3.scriptDispatchBindingSha256};
 const calls=[];
 const tx=async fn=>fn(async(q)=>{
  calls.push(q);
  if(q.includes('AS "sessionRole"'))return {rows:[role]};
  if(q.includes('AS "members"'))return {rows:[{members:1,reviewers:1}]};
  if(q.includes('clock_timestamp() AS "now"'))
   return {rows:[{now:new Date("2026-11-03T01:30:00.000Z")}]};
  if(q.startsWith("INSERT"))return {rows:[]}; // ON CONFLICT DO NOTHING: duplicate
  if(q.startsWith("SELECT approval_id"))return {rows:[row]};
  return {rows:[{}]};
 });
 const ledger=createBciContentRestrictedApprovalLedger({writeTransaction:tx,readTransaction:tx});
 await assert.rejects(ledger.appendV3(v3),/BCI_CONTENT_RESTRICTED_APPROVAL_DENIED/);
 assert.equal(calls.filter(q=>q.startsWith("INSERT")).length,1);
 assert.equal(calls.some(q=>q.startsWith("SELECT approval_id")),false,
  "duplicate V3 append must not reconcile by reading an existing row");
 assert.equal((await ledger.readbackV3(v3)).status,"committed_readback",
  "separate restricted readback is allowed for previously committed evidence");
 const v2=await harness();
 assert.equal((await v2.ledger.append(p)).status,"append_reconciled",
  "V2 append behavior must remain backward-compatible");
});


test("V3 rejects object identifiers without invoking attacker-controlled coercion",async()=>{
 let coerced=0;
 const hostile={toString(){coerced++;throw Error("coercion executed");}};
 const h=await harness();
 for(const field of ["approvalId","tenantId","reviewerId","dispatchIntentId",
  "signedReviewEvidenceId","scriptProofEnvelopeId","signedScriptMediaEvidenceId"]){
  await assert.rejects(h.ledger.appendV3({...v3,[field]:hostile}),
   /BCI_CONTENT_RESTRICTED_APPROVAL_DENIED/);
 }
 assert.equal(coerced,0,"untrusted identifiers must not execute toString");
 assert.equal(h.calls.some(x=>x.q.startsWith("INSERT")),false);
});

test("restricted ledger rejects approval expiring during append or readback",async()=>{
 for(const operation of ["append","readback"]){
  let clockReads=0,inserted=0;
  const tx=async fn=>fn(async q=>{
   if(q.includes('AS "sessionRole"'))return {rows:[role]};
   if(q.includes('AS "members"'))return {rows:[{members:1,reviewers:1}]};
   if(q.includes('clock_timestamp() AS "now"')){
    clockReads++;
    return {rows:[{now:new Date(clockReads===1?
     "2026-11-03T01:30:00.000Z":"2026-11-03T02:00:00.000Z")}]};
   }
   if(q.startsWith("INSERT")){inserted++;return {rows:[{approval_id:p.approvalId}]};}
   if(q.startsWith("SELECT approval_id"))throw Error("expired proof must not be read");
   return {rows:[{}]};
  });
  const ledger=createBciContentRestrictedApprovalLedger({writeTransaction:tx,readTransaction:tx});
  await assert.rejects(ledger[operation](p),/BCI_CONTENT_RESTRICTED_APPROVAL_DENIED/);
  assert.equal(clockReads,2);
  assert.equal(inserted,operation==="append"?1:0);
 }
});


test("restricted append and readback reject expiry reached during final row fetch",async()=>{
 const valid=new Date("2026-11-03T01:30:00.000Z");
 const expired=new Date("2026-11-03T02:00:00.000Z");
 for(const operation of ["append","readback"]){
  const h=await harness({clockSequence:[valid,valid,expired]});
  await assert.rejects(h.ledger[operation](p),/BCI_CONTENT_RESTRICTED_APPROVAL_DENIED/);
  assert.equal(h.calls.filter(x=>x.q.startsWith("SELECT approval_id")).length,1);
  assert.equal(h.calls.filter(x=>x.q.includes('clock_timestamp() AS "now"')).length,3);
 }
});

// Revocation between the initial preflight and final restricted readback must fail closed.
test("restricted ledger rejects reviewer revoked during transaction",async()=>{
 const {ledger}=await harness({authSequence:[{members:1,reviewers:1},{members:1,reviewers:0}]});
 await assert.rejects(()=>ledger.append(p),/BCI_CONTENT_RESTRICTED_APPROVAL_DENIED/);
});
