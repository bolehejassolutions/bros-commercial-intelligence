import test from "node:test";
import assert from "node:assert/strict";
import { proposeDemandMetaNextBestAction as propose } from "../lib/demand/meta-next-best-action.ts";

const scope = {
  tenantId:"11111111-1111-4111-8111-111111111111", product:"demand",
  accountId:"act_1997776120879476", campaignId:"120250864977630697",
  currency:"MYR", since:"2026-10-09", until:"2026-10-09",
  collectedAt:"2026-10-10T00:00:00Z",
};
const base = {
  campaign_id:scope.campaignId, date_start:scope.since, date_stop:scope.until,
  spend:124.93, impressions:117, clicks:8, inline_link_clicks:6,
  actions:[{action_type:"landing_page_view",value:3}],
};

test("click/landing gap proposes read-only measurement audit, not verified drop-off",()=>{
  const x=propose(scope,base);
  assert.equal(x.diagnosis,"CLICK_LANDING_MEASUREMENT_GAP");
  assert.equal(x.action,"AUDIT_CLICK_LANDING_MEASUREMENT");
  assert.equal(x.priority,"P2");
  assert.match(x.candidateId,/^demand:next-action:sha256:[a-f0-9]{64}$/);
  assert.match(x.evidenceCandidateKey,/^meta_ads:sha256:[a-f0-9]{64}$/);
  assert.equal(x.status,"PROPOSED_UNATTESTED");
  assert.equal(x.maxIncrementalSpendMinor,0);
  assert.equal(x.noProviderWrites,true);
  for(const key of ["providerAuthenticationVerified","tenantMembershipVerified",
    "ownerApproved","actionExecuted","outcomeVerified","learningVerified",
    "executionAllowed"]) assert.equal(x[key],false,key);
  for(const key of ["verifiedPaidOrders","verifiedSettledOrders","verifiedCacMinor","causalLift"])
    assert.equal(x[key],null,key);
  assert.equal(Object.isFrozen(x),true);
  assert.equal(Object.isFrozen(x.requiredEvidence),true);
});

test("unjoined Meta purchase is never promoted to a paid or settled order",()=>{
  const x=propose(scope,{...base,actions:[{action_type:"purchase",value:1},
    {action_type:"omni_purchase",value:1}]});
  assert.equal(x.diagnosis,"UNJOINED_PURCHASE_SIGNAL");
  assert.equal(x.action,"RECONCILE_PURCHASE_TO_HITPAY");
  assert.equal(x.priority,"P1");
  assert.equal(x.verifiedPaidOrders,null);
  assert.equal(x.verifiedCacMinor,null);
  assert.equal(x.causalLift,null);
});

test("conflicting aliases outrank purchase join and require alias reconciliation",()=>{
  const x=propose(scope,{...base,actions:[{action_type:"purchase",value:1},
    {action_type:"omni_purchase",value:2}]});
  assert.equal(x.diagnosis,"AMBIGUOUS_PURCHASE_ACTIONS");
  assert.equal(x.action,"AUDIT_META_ACTION_ALIASES");
  assert.equal(x.outcomeVerified,false);
});

test("unknown and explicit zero remain non-sale baseline evidence",()=>{
  for(const actions of [[],[{action_type:"purchase",value:0}]]) {
    const x=propose(scope,{...base,inline_link_clicks:undefined,actions});
    assert.equal(x.diagnosis,"FUNNEL_BASELINE_INCOMPLETE");
    assert.equal(x.action,"VERIFY_FUNNEL_BASELINE");
    assert.equal(x.verifiedPaidOrders,null);
  }
});

test("content-addressed candidate is idempotent on reread, distinct on revisions and tenant",()=>{
  const x=propose(scope,base);
  const replay=propose({...scope,collectedAt:"2026-10-10T01:00:00Z"},
    {...base,spend:"124.93",actions:[...base.actions]});
  assert.equal(x.candidateId,replay.candidateId);
  assert.equal(x.evidenceCandidateKey,replay.evidenceCandidateKey);
  assert.notEqual(x.candidateId,propose(scope,{...base,spend:125.93}).candidateId);
  assert.notEqual(x.candidateId,propose({...scope,
    tenantId:"22222222-2222-4222-8222-222222222222"},base).candidateId);
});

test("invalid tenant/campaign and malformed provider values fail closed",()=>{
  for(const [s,r] of [
    [{...scope,product:"content"},base],
    [{...scope,accountId:[scope.accountId]},base],
    [scope,{...base,spend:-5}],
    [scope,{...base,campaign_id:"999"}],
    [scope,{...base,actions:[{action_type:"purchase",value:"not-a-count"}]}],
  ]) assert.throws(()=>propose(s,r),/Invalid BROS DEMAND Meta insight/);
});
