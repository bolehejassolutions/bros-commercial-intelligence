import test from "node:test";
import assert from "node:assert/strict";
import { prepareDemandSequentialReadout as readout } from "../lib/demand/sequential-readout.ts";

const proposal = {
  tenantId: "11111111-1111-4111-8111-111111111111", product: "demand",
  pilotProduct: "bros_sell", metaAccountId: "act_1997776120879476",
  campaignId: "120250828102660697",
  hypothesis: "A clearer product explanation may improve qualified buying decisions.",
  action: "LANDING_PAGE_TEST", primaryKpi: "verified_paid_orders",
  baselineStart: "2026-10-01", baselineEnd: "2026-10-07",
  experimentStart: "2026-10-28", experimentEnd: "2026-11-03",
  preRegisteredAt: "2026-10-27T03:00:00Z",
  evidenceCandidateIds: ["meta_ads:sha256:"+"a".repeat(64)],
  maxIncrementalSpendMinor: 0,
};
const scope = (since,until,collectedAt="2026-11-05T00:00:00Z") => ({
  tenantId: proposal.tenantId, product: "demand",
  accountId: proposal.metaAccountId, campaignId: proposal.campaignId,
  currency: "MYR", since, until, collectedAt,
});
const bScope = scope(proposal.baselineStart,proposal.baselineEnd);
const fScope = scope(proposal.experimentStart,proposal.experimentEnd);
const row = (s, spend, clicks, lpv) => ({
  campaign_id: proposal.campaignId, date_start: s.since, date_stop: s.until,
  spend, inline_link_clicks: clicks,
  actions: [{action_type: "landing_page_view",value: lpv}],
});
const base = row(bScope,"100.00",40,20);
const follow = row(fScope,"120.00",45,25);
const make = (p=proposal,bs=bScope,br=base,fs=fScope,fr=follow) =>
  readout(p,bs,br,fs,fr);

test("equal past windows give only descriptive deltas, never verified KPI or causal lift",()=>{
  const x=make();
  assert.equal(x.status,"DESCRIPTIVE_READOUT_UNATTESTED");
  assert.equal(x.design,"SEQUENTIAL_BASELINE_NOT_CONTROLLED");
  assert.equal(x.comparableCalendarWindows,true);
  assert.equal(x.baselineDays,7);
  assert.equal(x.followupDays,7);
  assert.equal(x.spendDeltaMinor,2000);
  assert.equal(x.inlineLinkClickDelta,5);
  assert.equal(x.landingPageViewDelta,5);
  assert.equal(x.primaryKpi,"verified_paid_orders");
  assert.match(x.candidateId,/^demand:sequential-readout:sha256:[a-f0-9]{64}$/);
  for(const k of ["verifiedPrimaryKpi","causalLift","verifiedPaidOrders",
    "verifiedSettledOrders","verifiedCacMinor"]) assert.equal(x[k],null,k);
  for(const k of ["providerAuthenticationVerified","tenantAuthorizationVerified",
    "actionApproved","actionExecuted","outcomeVerified","learningVerified",
    "controlledExperimentVerified","causalInferenceEligible","executionAllowed"])
    assert.equal(x[k],false,k);
  assert.equal(Object.isFrozen(x),true);
  assert.equal(Object.isFrozen(x.observationCandidateKeys),true);
  assert.equal(Object.isFrozen(x.nextEvidenceRequired),true);
});

test("identical provider report rereads are idempotent; revisions create new candidate",()=>{
  const x=make();
  const reread=make(proposal,{...bScope,collectedAt:"2026-11-06T00:00:00Z"},
    {...base,spend:100}, {...fScope,collectedAt:"2026-11-06T00:00:00Z"},
    {...follow,spend:120});
  assert.equal(x.candidateId,reread.candidateId);
  assert.notEqual(x.candidateId,make(proposal,bScope,base,fScope,{...follow,spend:121}).candidateId);
  assert.notEqual(x.candidateId,make({...proposal,hypothesis:proposal.hypothesis+" Updated."}).candidateId);
});

test("unequal windows suppress misleading raw deltas",()=>{
  const p={...proposal,experimentEnd:"2026-11-04"};
  const fs=scope(p.experimentStart,p.experimentEnd);
  const x=make(p,bScope,base,fs,row(fs,"120.00",45,25));
  assert.equal(x.comparableCalendarWindows,false);
  assert.equal(x.followupDays,8);
  assert.equal(x.spendDeltaMinor,null);
  assert.equal(x.inlineLinkClickDelta,null);
  assert.equal(x.landingPageViewDelta,null);
});

test("current MYT day suppresses premature comparison even if report has numbers",()=>{
  const fs=scope(proposal.experimentStart,proposal.experimentEnd,"2026-11-03T12:00:00Z");
  const x=make(proposal,bScope,base,fs,follow);
  assert.equal(x.comparableCalendarWindows,false);
  assert.equal(x.spendDeltaMinor,null);
});

test("missing vs provider zero remains distinct; missing yields no delta",()=>{
  const x=make(proposal,bScope,{...base,inline_link_clicks:undefined,
    actions:[]},fScope,{...follow,inline_link_clicks:0,
    actions:[{action_type:"landing_page_view",value:0}]});
  assert.equal(x.inlineLinkClickDelta,null);
  assert.equal(x.landingPageViewDelta,null);
  assert.equal(x.verifiedPrimaryKpi,null);
});

test("reject mismatched tenant, campaign, account or proposal windows",()=>{
  for(const [p,bs,br,fs,fr] of [
    [proposal,{...bScope,tenantId:"22222222-2222-4222-8222-222222222222"},base,fScope,follow],
    [proposal,{...bScope,accountId:"act_999"},base,fScope,follow],
    [proposal,{...bScope,campaignId:"999"},base,fScope,follow],
    [proposal,bScope,base,{...fScope,since:"2026-10-29"},follow],
    [{...proposal,campaignId:"999"},bScope,base,fScope,follow],
  ]) assert.throws(()=>make(p,bs,br,fs,fr),
    /Invalid BROS DEMAND (sequential readout|Meta insight)/);
});

test("forged verification flags cannot authorize or upgrade observational readout",()=>{
  const x=make({...proposal,actionApproved:true,outcomeVerified:true,
    learningVerified:true,verifiedPaidOrders:100,causalLift:1});
  assert.equal(x.actionApproved,false);
  assert.equal(x.outcomeVerified,false);
  assert.equal(x.learningVerified,false);
  assert.equal(x.verifiedPaidOrders,null);
  assert.equal(x.causalLift,null);
});
