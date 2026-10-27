/**
 * PORTFOLIO_CONTENT_LEARNING_GAP_20261027_1626
 * Coordinator-only characterization of a missing acceptance criterion.
 * Existing BCI readiness is a PURE PROJECTION, not an authoritative release
 * decision. This synthetic test NEVER verifies approval, provider SENT,
 * measurement, actual learning, tenant auth, or durable audit.
 *
 * Known gap: the current shared CONTENT stage contract ends at measurement;
 * the owner-approved INTERNAL V1 acceptance requires measurement -> learning.
 * The CONTENT/BCI workers own the eventual product/shared-core correction.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { assessInternalReadiness } from '../lib/bci/internal-readiness.ts';

const tenantId='33333333-3333-4333-8333-333333333333';
const contentId='synthetic-content-learning-gap';
const experimentId='synthetic-experiment-learning-gap';

test('four-stage CONTENT projection is NOT a portfolio release acceptance without verified learning',()=>{
  const contentEvidence=['media_qa','approval','provider_sent','measurement'].map((stage,i)=>({
    tenantId,product:'content',contentId,stage,
    sourceKey:'synthetic:content:'+stage,verified:true,
    at:new Date(Date.UTC(2026,9,27,1,i)).toISOString(),
    ...(stage==='provider_sent'?{providerPostId:'synthetic-post'}:{}),
  }));
  const demandEvidence=['diagnosis','decision','action','outcome','learning'].map((stage,i)=>({
    tenantId,product:'demand',experimentId,stage,
    sourceKey:'synthetic:demand:'+stage,verified:true,
    observedAt:new Date(Date.UTC(2026,9,27,2,i)).toISOString(),
    ...(stage==='outcome'?{outcomeClass:'provider_verified'}:{}),
  }));
  // These booleans are SYNTHETIC, NOT authenticated attestations.
  const projection=assessInternalReadiness({
    tenantId,contentId,contentEvidence,experimentId,demandEvidence,
    neonNegativeTestsVerified:true,sharedBciAuditVerified:true,
    hitpayReconciliationVerified:true,
  });
  assert.equal(projection.contentEvidenceComplete,true);
  assert.equal(projection.internalV1Ready,true,
    'Characterizes existing pure projection; this MUST NOT be treated as release evidence');
  const learningProof=contentEvidence.filter(row=>
    row.stage==='learning' && row.verified===true);
  assert.equal(learningProof.length,0);
  const ownerAcceptance=projection.internalV1Ready && learningProof.length>0;
  assert.equal(ownerAcceptance,false,
    'Owner-approved CONTENT measurement->learning gate remains OPEN');
});
