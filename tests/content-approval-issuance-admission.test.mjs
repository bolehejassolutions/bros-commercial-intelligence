import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {createBciContentApprovalAdmission} from "../lib/bci/content-approval-issuance-admission.mjs";

const tenantId="22222222-2222-4222-8222-222222222222";
const reviewerId="11111111-1111-4111-8111-111111111111";
const bytes=Buffer.alloc(64,42);
const sha=createHash("sha256").update(bytes).digest("hex");
const media={handoffId:"content-handoff",reviewPacketId:"content-review",
  mediaSetId:"content-media",originalMediaSha256:sha,mediaCount:1};
const verified={product:"content",tenantId,reviewerSubject:reviewerId,
  reviewerProvider:"neon-auth",signedDecision:"APPROVE",signatureVerified:true,
  signedReviewEvidenceId:"content-signed-review",expiresAt:"2026-11-01T00:00:00.000Z",
  handoffId:media.handoffId,reviewPacketId:media.reviewPacketId,mediaSetId:media.mediaSetId,
  originalMediaSha256:sha,mediaCount:1};
const binding={reviewPacketId:media.reviewPacketId,handoffId:media.handoffId,
  signedReviewEvidenceId:verified.signedReviewEvidenceId,planId:"content-plan",
  mediaSetId:media.mediaSetId,copySha256:"a".repeat(64),
  providerOrganizationId:"org-1",channelId:"channel-1"};
const request={dispatchIntentId:"content-intent",binding,mediaBytes:bytes,receipt:{untrusted:true}};
const bindingKeys=["reviewPacketId","handoffId","signedReviewEvidenceId","planId",
  "mediaSetId","copySha256","providerOrganizationId","channelId"];
const bindingSha256=createHash("sha256")
  .update(JSON.stringify(bindingKeys.map(k=>binding[k]))).digest("hex");
const signedDispatchIntentSha256=createHash("sha256")
  .update("BCI_CONTENT_DISPATCH_INTENT_V1\n")
  .update(JSON.stringify([request.dispatchIntentId,bindingSha256])).digest("hex");
const signedVerified={...verified,signedDispatchIntentSha256};
const authority={principalId:reviewerId,tenantId,product:"content",
  memberActive:true,reviewerAuthorized:true,revokedAt:null};
const denied=/BCI_CONTENT_APPROVAL_ADMISSION_DENIED/;
const now=Date.parse("2026-10-31T12:00:00.000Z");
function setup(overrides={}){
  const calls=[];
  const deps={
    recomputeOriginalMedia:async()=>{calls.push("media");return media;},
    verifySignedReceipt:async()=>{calls.push("signature");return signedVerified;},
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
  assert.equal(result.mediaCount,1);
  assert.match(result.bindingSha256,/^[a-f0-9]{64}$/);
  assert.equal(result.dispatchIntentSha256,signedDispatchIntentSha256);
  assert.deepEqual(h.calls,["media","signature","jwt","authority"]);
});
test("untrusted original media digest fails before signature/JWT",async()=>{
  const h=setup({recomputeOriginalMedia:async()=>({...media,originalMediaSha256:"b".repeat(64)})});
  await assert.rejects(h.admit(request),denied);
});
test("signed decision rejection, bad signature and expired receipt fail closed",async()=>{
  for(const patch of [{signedDecision:"REJECT"},{signatureVerified:false},
    {expiresAt:"2026-10-31T11:59:59.000Z"}]){
    const h=setup({verifySignedReceipt:async()=>({...signedVerified,...patch})});
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

test("multi-image media-set cannot be admitted by attesting only the first image",async()=>{
  const h=setup({recomputeOriginalMedia:async()=>({...media,mediaCount:2})});
  await assert.rejects(h.admit(request),denied);
  assert.deepEqual(h.calls,[]);
});
test("signed carousel receipt cannot masquerade as a one-image review",async()=>{
  const h=setup({verifySignedReceipt:async()=>({...verified,mediaCount:2})});
  await assert.rejects(h.admit(request),denied);
});
test("signed receipt must bind the exact recomputed original image digest",async()=>{
  const h=setup({verifySignedReceipt:async()=>({...verified,originalMediaSha256:"b".repeat(64)})});
  await assert.rejects(h.admit(request),denied);
});
test("missing independently verified media count or signed digest fails closed",async()=>{
  const h=setup({recomputeOriginalMedia:async()=>({
    handoffId:media.handoffId,reviewPacketId:media.reviewPacketId,
    mediaSetId:media.mediaSetId,originalMediaSha256:sha
  })});
  await assert.rejects(h.admit(request),denied);
  const g=setup({verifySignedReceipt:async()=>({
    product:verified.product,tenantId:verified.tenantId,
    reviewerSubject:verified.reviewerSubject,reviewerProvider:verified.reviewerProvider,
    signedDecision:verified.signedDecision,signatureVerified:verified.signatureVerified,
    signedReviewEvidenceId:verified.signedReviewEvidenceId,expiresAt:verified.expiresAt,
    handoffId:verified.handoffId,reviewPacketId:verified.reviewPacketId,
    mediaSetId:verified.mediaSetId,mediaCount:1
  })});
  await assert.rejects(g.admit(request),denied);
});
test("caller cannot declare media count or a second original image",async()=>{
  const h=setup();
  await assert.rejects(h.admit({...request,mediaCount:1}),denied);
  await assert.rejects(h.admit({...request,mediaBytes2:Buffer.alloc(64)}),denied);
});

test("signed dispatch intent rejects altered copy, plan, provider, channel and intent",async()=>{
  for(const field of ["copySha256","planId","providerOrganizationId","channelId"]) {
    const h=setup();
    const value=field==="copySha256"?"b".repeat(64):"tampered-"+field;
    await assert.rejects(h.admit({...request,binding:{...binding,[field]:value}}),denied);
  }
  const h=setup();
  await assert.rejects(h.admit({...request,dispatchIntentId:"replayed-intent"}),denied);
});
test("missing or fabricated signed intent digest never admits",async()=>{
  for(const value of [undefined,"b".repeat(64)]) {
    const h=setup({verifySignedReceipt:async()=>({
      ...signedVerified,signedDispatchIntentSha256:value
    })});
    await assert.rejects(h.admit(request),denied);
  }
  const h=setup();
  await assert.rejects(h.admit({...request,signedDispatchIntentSha256}),denied);
});
test("admission snapshots mutable original bytes and dispatch binding before async checks",async()=>{
  const mutableBytes=Buffer.from(bytes),mutableBinding={...binding};
  const mutableRequest={...request,mediaBytes:mutableBytes,binding:mutableBinding};
  const h=setup({recomputeOriginalMedia:async mediaBytes=>{
    mutableBytes.fill(1);
    mutableBinding.channelId="changed-after-await";
    mutableRequest.dispatchIntentId="changed-after-await";
    assert.equal(createHash("sha256").update(mediaBytes).digest("hex"),sha);
    return media;
  }});
  const result=await h.admit(mutableRequest);
  assert.equal(result.dispatchIntentId,request.dispatchIntentId);
  assert.equal(result.dispatchIntentSha256,signedDispatchIntentSha256);
});

test("signed proof fields cannot change after verification while JWT is awaited",async()=>{
  const mutable={...signedVerified};
  const h=setup({
    verifySignedReceipt:async()=>mutable,
    authenticateReviewer:async()=>{
      mutable.signedReviewEvidenceId="forged-after-signature";
      mutable.expiresAt="2026-11-02T00:00:00.000Z";
      return {userId:reviewerId,authenticated:true};
    }
  });
  const result=await h.admit(request);
  assert.equal(result.signedReviewEvidenceId,verified.signedReviewEvidenceId);
  assert.equal(result.expiresAt,verified.expiresAt);
  assert.equal(result.bindingSha256,bindingSha256);
});

test("original-byte media manifest is pinned before asynchronous signature verification",async()=>{
  const mutable={...media};
  const h=setup({
    recomputeOriginalMedia:async()=>mutable,
    verifySignedReceipt:async()=>{
      mutable.originalMediaSha256="b".repeat(64);
      return signedVerified;
    }
  });
  const result=await h.admit(request);
  assert.equal(result.originalMediaSha256,sha);
  assert.equal(result.mediaCount,1);
});
