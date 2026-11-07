import test from "node:test";
import assert from "node:assert/strict";
import { createDemandMetaPersistedDiagnosisHandler, createDemandMetaReceiptReader,
  reviewPersistedDemandMetaReceipt, DEMAND_PILOT_RECEIPT_ID } from "../lib/demand/meta-persisted-diagnosis.ts";
import { createPgReadOnlyTransaction } from "../lib/bci/neon-readonly-transaction.ts";
import { RESTRICTED_EVIDENCE_WRITER_POLICIES } from "../lib/bci/neon-evidence-writer-policy-fingerprint.ts";

const tenant="c0d63101-218d-4b67-9efc-e27b45330963";
const principal="33333333-3333-4333-8333-333333333333";
const jwt="eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.c2lnbmF0dXJl";
const url="https://preview.example/api/internal/demand-meta-diagnosis";
const receipt=Object.freeze({id:DEMAND_PILOT_RECEIPT_ID,tenantId:tenant,product:"demand",
  provider:"meta_ads",completeness:"unverified",
  providerRecordKey:"demand:meta-read:sha256:"+"a".repeat(64),
  collectedAt:"2026-11-01T07:22:59.000Z",periodStart:"2026-10-07T16:00:00.000Z",
  periodEnd:"2026-10-27T15:59:59.000Z",
  metrics:{spend_minor:12493,inline_link_clicks:63,landing_page_views:33,
    meta_attributed_purchases:1,pixel_purchase_events:1},
  unknowns:["independent_provider_receipt_not_verified","hitpay_paid_order_not_reconciled","campaign_impact_not_causal"]});
const req=(patch={})=>new Request(patch.url??url,{method:patch.method??"GET",
  headers:{Authorization:"Bearer "+jwt,...patch.headers}});
const deps=(patch={})=>{const state={auth:0,membership:0,reads:0};
  return {state,handler:createDemandMetaPersistedDiagnosisHandler({
    enabled:()=>patch.enabled??true,tenantId:tenant,
    verifyJwt:async()=>{state.auth++;return patch.invalid?null:{userId:principal,authenticated:true}},
    membershipsFor:async()=>{state.membership++;return patch.revoked&&state.membership>1?[]:
      [{principalId:principal,tenantId:tenant,product:"demand",active:true}]},
    readReceipt:async()=>{state.reads++;return patch.missing?null:receipt},
  })};
};

test("real stored Meta receipt projects reviewable diagnosis, never a paid order, CPA or executed experiment",()=>{
  const r=reviewPersistedDemandMetaReceipt(receipt);
  assert.equal(r.recordId,DEMAND_PILOT_RECEIPT_ID);
  assert.equal(r.observed.spendMinor,12493);
  assert.equal(r.observed.metaAttributedPurchases,1);
  assert.equal(r.observed.pixelPurchaseEvents,1);
  assert.equal(r.verifiedPaidOrders,null);
  assert.equal(r.verifiedCpaMinor,null);
  assert.equal(r.causalLift,null);
  assert.equal(r.actionAuthorized,false);
  assert.equal(r.actionExecuted,false);
  assert.equal(r.outcomeVerified,false);
  assert.equal(r.learningRecorded,false);
  assert.equal(r.firstPartyAttribution,"unknown");
  assert.equal(r.caseLink,null);
});
test("real same-scope BCI REVIEW case is projected without implying approval or outcomes",()=>{
  const linkedCase={caseId:"a474cd88-76a3-4c96-8cde-4fcfea45be83",
    evidenceId:DEMAND_PILOT_RECEIPT_ID,tenantId:tenant,product:"demand",status:"REVIEW"};
  const r=reviewPersistedDemandMetaReceipt({...receipt,linkedCase});
  assert.equal(r.caseLink.caseId,linkedCase.caseId);
  assert.equal(r.caseLink.status,"REVIEW");
  assert.equal(r.caseLink.actionAuthorized,false);
  assert.equal(r.caseLink.outcomeVerified,false);
  assert.throws(()=>reviewPersistedDemandMetaReceipt({...receipt,linkedCase:{...linkedCase,tenantId:"11111111-1111-4111-8111-111111111111"}}));
  assert.throws(()=>reviewPersistedDemandMetaReceipt({...receipt,linkedCase:{...linkedCase,status:"APPROVED"}}));
});
test("missing fields are unknown, never fabricated zero",()=>{
  const r=reviewPersistedDemandMetaReceipt({...receipt,metrics:{...receipt.metrics,spend_minor:null,landing_page_views:null}});
  assert.equal(r.observed.spendMinor,null);assert.equal(r.observed.landingPageViews,null);
  assert.throws(()=>reviewPersistedDemandMetaReceipt({...receipt,metrics:{...receipt.metrics,spend_minor:-1}}));
  assert.throws(()=>reviewPersistedDemandMetaReceipt({...receipt,tenantId:"11111111-1111-4111-8111-111111111111",id:"44444444-4444-4444-8444-444444444444"}));
});
test("signed review GET returns only bounded observation and proposal, no Meta request or DB write",async()=>{
  const {state,handler}=deps();const response=await handler(req());
  assert.equal(response.status,200);assert.equal(response.headers.get("cache-control").includes("no-store"),true);
  const body=await response.json();
  assert.equal(body.source,"NEON_DEV_BCI_PERSISTED_META_EVIDENCE");
  assert.equal(body.status,"REVIEWABLE_NOT_APPROVED");
  assert.equal(body.actionAuthorized,false);
  assert.equal(body.outcomeVerified,false);
  assert.equal(state.reads,1);assert.equal(state.membership,2);
  assert.equal(JSON.stringify(body).includes(tenant),false);
});
test("disabled, non-GET, scope injection and no-token reject before membership and SQL",async()=>{
  for(const [patch,status] of [
    [{enabled:false},404],
    [{request:{method:"POST"}},405],
    [{request:{url:url+"?tenantId="+tenant}},400],
    [{request:{headers:{"x-tenant-id":tenant}}},400],
    [{request:{headers:{Authorization:""}}},401],
  ]){const {state,handler}=deps(patch);
    assert.equal((await handler(req(patch.request??{}))).status,status);
    assert.equal(state.auth,0);assert.equal(state.reads,0);
  }
});
test("revocation, invalid identity, missing receipt fail closed",async()=>{
  for(const [patch,status] of [[{invalid:true},403],[{revoked:true},403],[{missing:true},404]]){
    const {state,handler}=deps(patch);
    assert.equal((await handler(req())).status,status);
    if(patch.invalid) assert.equal(state.reads,0);
  }
});
test("existing BCI restricted physical writer performs only a scoped READ ONLY transaction",async()=>{
  const statements=[];const pool={connect:async()=>({release(){},query:async(sql,params=[])=>{
    statements.push(sql);
    if(sql.includes("AS role_name"))return {rows:[{role_name:"bci_dev_evidence_writer_restricted",
      session_role_name:"bci_dev_evidence_writer_restricted",can_login:true,bypass_rls:false,
      superuser:false,inherits:false,parent_roles:0}]};
    if(sql.includes("AS database_name"))return {rows:[{database_name:"bros_intelligence_dev",
      forced_rls:true,can_read:true,no_mutation:true,cases_rls:true,links_rls:true,
      cases_read:true,links_read:true,cases_no_mutation:true,links_no_mutation:true}]};
    if(sql.includes("FROM pg_policies"))return {rows:RESTRICTED_EVIDENCE_WRITER_POLICIES};
    if(sql.includes("FROM bci_dev.tenant_memberships"))return {rows:[{principal_id:principal}]};
    if(sql.includes("FROM bci_dev.evidence"))return {rows:[receipt]};
    if(sql.includes("FROM bci_dev.case_evidence"))return {rows:[{caseId:"a474cd88-76a3-4c96-8cde-4fcfea45be83",evidenceId:DEMAND_PILOT_RECEIPT_ID,tenantId:tenant,product:"demand",status:"REVIEW"}]};
    return {rows:[]};
  }})};
  const reader=createDemandMetaReceiptReader(createPgReadOnlyTransaction(pool));
  const result=await reader(tenant,principal);
  assert.equal(result.id,DEMAND_PILOT_RECEIPT_ID);
  assert.equal(result.linkedCase?.status,"REVIEW");
  assert.equal(result.linkedCase?.evidenceId,DEMAND_PILOT_RECEIPT_ID);
  assert.ok(statements.includes("BEGIN READ ONLY"));
  assert.equal(statements.some(s=>/\b(INSERT|UPDATE|DELETE)\s+(INTO|bci_dev)/i.test(s)),false);
  assert.equal(statements.filter(s=>s.includes("FROM bci_dev.tenant_memberships")).length,2);
  assert.ok(statements.includes("COMMIT"));
});
test("SQL role impersonation denies before scoped evidence SELECT",async()=>{
  const statements=[];const pool={connect:async()=>({release(){},query:async(sql)=>{
    statements.push(sql);
    if(sql.includes("AS role_name"))return {rows:[{role_name:"bci_dev_evidence_writer_restricted",
      session_role_name:"BROS",can_login:true,bypass_rls:false,superuser:false,
      inherits:false,parent_roles:0}]};
    return {rows:[]};
  }})};
  await assert.rejects(()=>createDemandMetaReceiptReader(createPgReadOnlyTransaction(pool))(tenant,principal));
  assert.equal(statements.some(s=>s.includes("FROM bci_dev.evidence")),false);
});
