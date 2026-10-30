import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {createBciContentApprovalAdmission} from "../lib/bci/content-approval-issuance-admission.mjs";

const tenantId="22222222-2222-4222-8222-222222222222";
const reviewerId="11111111-1111-4111-8111-111111111111";
const bytes=Buffer.alloc(64,42);
const sha=createHash("sha256").update(bytes).digest("hex");
const media={handoffId:"content-handoff",reviewPacketId:"content-review",
  mediaSetId:"content-media",originalMediaSha256:sha};
const verified={product:"content",tenantId,reviewerSubject:reviewerId,
  reviewerProvider:"neon-auth",signedDecision:"APPROVE",signatureVerified:true,
  signedReviewEvidenceId:"content-signed-review",expiresAt:"2026-11-01T00:00:00.000Z",
  handoffId:media.handoffId,reviewPacketId:media.reviewPacketId,mediaSetId:media.mediaSetId};
const binding={reviewPacketId:media.reviewPacketId,handoffId:media.handoffId,
  signedReviewEvidenceId:verified.signedReviewEvidenceId,planId:"content-plan",
  mediaSetId:media.mediaSetId,copySha256:"a".repeat(64),
  providerOrganizationId:"org-1",channelId:"channel-1"};
const request={dispatchIntentId:"content-intent",binding,mediaBytes:bytes,receipt:{untrusted:true}};
const authority={principalId:reviewerId,tenantId,product:"content",
  memberActive:true,reviewerAuthorized:true,revokedAt:null};
const denied=/BCI_CONTENT_APPROVAL_ADMISSION_DENIED/;
const now=Date.parse("2026-10-31T12:00:00.000Z");
function setup(overrides={}){
  const calls=[];
  const deps={
    recomputeOriginalMedia:async()=>{calls.push("media");return media;},
    verifySignedReceipt:async()=>{calls.push("signature");return verified;},
    authenticateReviewer:async()=>{calls.push("jwt");return {userId:reviewerId,authenticated:true};},
    readReviewerAuthority:async()=>{calls.push("authority");return authority;},
    now:()=>now,...overrides
  };
  return {admit:createBciContentApprovalAdmission(deps),calls};
}
test("admission only binds signed review, original bytes, JWT and live reviewer role",async()=>{
  const h=setup();const result=await h.admit(request);
  assert.equal(result.status,"ADMITTED_FOR_TRUSTED_ISSUER_ONLY");
  assert.equal(result.durableApprovalRecorded,false);
  assert.equal(result.executionAllowed,false);
  assert.equal(result.providerSent,false);
  assert.equal(result.originalMediaSha256,sha);
  assert.match(result.bindingSha256,/^[a-f0-9]{64}$/);
  assert.deepEqual(h.calls,["media","signature","jwt","authority"]);
});
test("untrusted original media digest fails before signature/JWT",async()=>{
  const h=setup({recomputeOriginalMedia:async()=>({...media,originalMediaSha256:"b".repeat(64)})});
  await assert.rejects(h.admit(request),denied);
});
test("signed decision rejection, bad signature and expired receipt fail closed",async()=>{
  for(const patch of [{signedDecision:"REJECT"},{signatureVerified:false},
    {expiresAt:"2026-10-31T11:59:59.000Z"}]){
    const h=setup({verifySignedReceipt:async()=>({...verified,...patch})});
    await assert.rejects(h.admit(request),denied);
  }
});
test("receipt cannot substitute cross-tenant or cross-product reviewer authority",async()=>{
  for(const patch of [{tenantId:"33333333-3333-4333-8333-333333333333"},
    {product:"demand"},{reviewerAuthorized:false},{memberActive:false},
    {revokedAt:"2026-10-31T10:00:00.000Z"}]){
    const h=setup({readReviewerAuthority:async()=>({...authority,...patch})});
    await assert.rejects(h.admit(request),denied);
  }
});
test("signed reviewer and JWT identity must match",async()=>{
  const h=setup({authenticateReviewer:async()=>({
    userId:"44444444-4444-4444-8444-444444444444",authenticated:true})});
  await assert.rejects(h.admit(request),denied);
});
test("dispatch binding must match recomputed handoff and verified signature evidence",async()=>{
  for(const patch of [{handoffId:"wrong-handoff"},{signedReviewEvidenceId:"wrong-review"}]){
    const h=setup();
    await assert.rejects(h.admit({...request,binding:{...binding,...patch}}),denied);
  }
});
test("request cannot inject tenant, reviewer, provider status or arbitrary fields",async()=>{
  const h=setup();await assert.rejects(h.admit({...request,tenantId}),denied);
});
test("authority lookup errors sanitize secrets and never admit",async()=>{
  const h=setup({readReviewerAuthority:async()=>{throw Error("DATABASE_URL=secret");}});
  await assert.rejects(h.admit(request),e=>e.message==="BCI_CONTENT_APPROVAL_ADMISSION_DENIED");
});
test("unverified or missing dependencies fail closed",async()=>{
  assert.throws(()=>createBciContentApprovalAdmission({}),denied);
  const h=setup({verifySignedReceipt:async()=>({...verified,extra:true})});
  await assert.rejects(h.admit(request),denied);
});
