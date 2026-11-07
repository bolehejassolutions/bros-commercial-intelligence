import test from "node:test";
import assert from "node:assert/strict";
import { proposeDemandConcurrentControl as propose } from "../lib/demand/concurrent-control-protocol.ts";
import { reviewDemandConcurrentLearningReadiness as review } from "../lib/demand/concurrent-learning-readiness.ts";

const tenantId = "11111111-1111-4111-8111-111111111111";
const proposal = propose({
  tenantId, product: "demand", pilotProduct: "bros_sell",
  metaAccountId: "act_1997776120879476", campaignId: "120250828102660697",
  hypothesis: "A clearer offer explanation may improve qualified purchase decisions.",
  action: "LANDING_PAGE_TEST",
  treatmentChange: "Explain scope and the unchanged one-off RM100 price more clearly.",
  primaryKpi: "verified_paid_orders",
  plannedStart: "2026-10-29", plannedEnd: "2026-11-04",
  preRegisteredAt: "2026-10-27T07:00:00Z",
  evidenceCandidateIds: ["meta_ads:sha256:" + "a".repeat(64)],
  assignmentUnit: "CONSENTED_LANDING_VISITOR",
  assignmentMethod: "STICKY_RANDOM_50_50_PROPOSED",
  controlExperience: "UNCHANGED_EXISTING_LANDING_PAGE",
  analysisPolicy: "INTENTION_TO_TREAT", maxIncrementalSpendMinor: 0,
});
const a = "a".repeat(64), b = "b".repeat(64);
const exposure = (eventId, visitorDigest, kind, arm, patch={}) => ({
  eventId, experimentCandidateId: proposal.candidateId, tenantId, product: "demand",
  visitorDigest, kind, arm, observedAt: "2026-10-29T04:00:00Z",
  consentRecorded: true, ...patch,
});
const events = [
  exposure("assign:a", a, "assignment", "control"),
  exposure("expose:a", a, "exposure", "control"),
  exposure("assign:b", b, "assignment", "treatment"),
  exposure("expose:b", b, "exposure", "treatment"),
];
const order = (eventId, visitorDigest, arm, digest, patch={}) => ({
  eventId, experimentCandidateId: proposal.candidateId, tenantId,
  product: "demand", pilotProduct: "bros_sell", visitorDigest,
  orderCandidateKey: "demand:hitpay-candidate:sha256:" + digest,
  orderIdentityDigest: digest, arm, observedAt: "2026-10-29T06:00:00Z", ...patch,
});
const orders = [order("checkout:a",a,"control","c".repeat(64)),
  order("checkout:b",b,"treatment","d".repeat(64))];

test("consistent candidates remain unverified, never conversions or learning", () => {
  const x = review(proposal, events, orders);
  assert.equal(x.status, "EVIDENCE_GAPS_OPEN_UNATTESTED");
  assert.equal(x.exposureStructuralConsistency, true);
  assert.equal(x.orderStructuralConsistency, true);
  assert.equal(x.nextAction, "ATTEST_APPROVAL_EXECUTION_PROVIDER_AND_BCI_LEARNING");
  assert.equal(x.uniqueOrderIdentityCandidates, 2);
  assert.deepEqual([x.controlAssignmentCandidates,x.treatmentAssignmentCandidates],[1,1]);
  for (const key of ["ownerApprovalVerified","actionExecutedVerified",
    "providerAuthenticationVerified","tenantAuthorizationVerified",
    "hitpaySettlementVerified","entitlementVerified","attributionVerified",
    "outcomeVerified","learningVerified","controlledExperimentVerified",
    "causalInferenceEligible","executionAllowed"]) assert.equal(x[key],false,key);
  for (const key of ["verifiedPaidOrders","verifiedSettledOrders",
    "verifiedConversionRate","verifiedCacMinor","causalLift"]) assert.equal(x[key],null,key);
  assert.equal(x.learningCandidate,"UNVERIFIED_NO_OUTCOME_OR_CAUSAL_CLAIM");
  assert.ok(Object.isFrozen(x)); assert.ok(Object.isFrozen(x.findings));
  assert.ok(Object.isFrozen(x.requiredIndependentEvidence));
});

test("identical reordered provider pages yield stable candidate and action", () => {
  const x=review(proposal,events,orders);
  const y=review(proposal,[...events].reverse(),[...orders].reverse());
  assert.deepEqual(x,y);
  assert.match(x.candidateId,/^demand:learning-readiness:sha256:[a-f0-9]{64}$/);
});

test("missing order candidates are unknown, not verified zero", () => {
  const x=review(proposal,events,[]);
  assert.equal(x.nextAction,"OBTAIN_HITPAY_ORDER_EVIDENCE");
  assert.equal(x.priority,"P2");
  assert.equal(x.verifiedPaidOrders,null);
  assert.equal(x.uniqueOrderIdentityCandidates,null);
  assert.ok(x.findings.includes("ORDER:NO_ORDER_CANDIDATES_OBSERVED"));
});

test("assignment, exposure or consent defects outrank order review", () => {
  const bad=[...events.slice(0,3),exposure("expose:b",b,"exposure","control",
    {consentRecorded:false})];
  const x=review(proposal,bad,orders);
  assert.equal(x.nextAction,"REVIEW_ASSIGNMENT_EXPOSURE_CONSENT");
  assert.equal(x.priority,"P1");
  assert.ok(x.findings.includes("EXPOSURE:CROSS_ARM_CONTAMINATION"));
  assert.equal(x.causalLift,null);
});

test("reused order identity across arms requires reconciliation", () => {
  const conflict=[orders[0],{...orders[1],orderIdentityDigest:"c".repeat(64)}];
  const x=review(proposal,events,conflict);
  assert.equal(x.nextAction,"REVIEW_ORDER_EXPOSURE_JOIN");
  assert.equal(x.priority,"P1");
  assert.ok(x.findings.includes("ORDER:SAME_ORDER_CROSS_ARM"));
  assert.equal(x.verifiedConversionRate,null);
});

test("forged approval and scope cannot upgrade review", () => {
  assert.throws(()=>review({...proposal,actionApproved:true},events,orders),
    /Invalid BROS DEMAND concurrent exposure candidates/);
  assert.throws(()=>review(proposal,[{...events[0],tenantId:"wrong"},...events.slice(1)],orders),
    /Invalid BROS DEMAND concurrent exposure candidates/);
  assert.throws(()=>review(proposal,events,[{...orders[0],orderCandidateKey:"Order #1007"}]),
    /Invalid BROS DEMAND order exposure candidates/);
});

test("revised candidate evidence changes identity without claiming a sale", () => {
  const x=review(proposal,events,orders);
  const changed=review(proposal,events,[orders[0],
    {...orders[1],orderCandidateKey:"demand:hitpay-candidate:sha256:"+"e".repeat(64)}]);
  assert.notEqual(x.candidateId,changed.candidateId);
  assert.equal(changed.verifiedPaidOrders,null);
  assert.equal(changed.outcomeVerified,false);
});
