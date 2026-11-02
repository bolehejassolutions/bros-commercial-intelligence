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
 const row={approvalId:p.approvalId,tenantId:tenant,product:"content",
 dispatchIntentId:p.dispatchIntentId,approvedBy:uuid,bindingSha256:p.bindingSha256,
 signedProofVersion:2,signedReviewEvidenceId:p.signedReviewEvidenceId,
 originalMediaSha256:p.originalMediaSha256,originalMediaCount:1,
 signedDispatchIntentSha256:p.signedDispatchIntentSha256,
 reviewDigest:digestA,admissionDigest:digestB,signedAdmissionNonce:p.signedAdmissionNonce};
 const tx=async fn=>fn(async(q,params)=>{
  calls.push({q,params});
  if(q.includes('AS "sessionRole"'))return {rows:[opts.role??role]};
  if(q.includes('AS "members"'))return {rows:[{members:opts.members??1,reviewers:opts.reviewers??1}]};
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
