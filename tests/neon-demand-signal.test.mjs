import test from "node:test";
import assert from "node:assert/strict";
import { interpretPersistedDemandMetaSignal, DEMAND_META_SIGNAL_SOURCE_SHA256 }
  from "../lib/demand/meta-persisted-signal.ts";
import { createAuthenticatedDemandMetaSignal } from "../lib/bci/neon-demand-signal.ts";
import { createAuthenticatedBciLineageReadback, createPgLineageReadTransaction,
  createPgLineageWriteTransaction, EXPECTED_LINEAGE_POLICY_FINGERPRINTS }
  from "../lib/bci/neon-lineage-writer.ts";

// Recorded DEV source fixture. These tests simulate SQL/auth; they are NOT
// independent provider, physical LOGIN or hosted authenticated acceptance.
const tenant="c0d63101-218d-4b67-9efc-e27b45330963";
const userId="33333333-3333-4333-8333-333333333333";
const source={id:"4b1d0b40-371f-4c82-aaa9-d77580f88fac",tenantId:tenant,product:"demand",
  provider:"meta_ads",completeness:"unverified",
  providerRecordKey:"demand:meta-read:sha256:a31d0438050fc4745e4a8c8b8fd36a1ab2345937e7fa55bfa68076f08c1b5a16",
  periodStart:"2026-10-07T16:00:00.000Z",periodEnd:"2026-10-27T15:59:59.000Z",
  collectedAt:"2026-11-01T07:22:59.000Z",
  metrics:{spend_minor:12493,inline_link_clicks:63,landing_page_views:33,
    meta_attributed_purchases:1,pixel_purchase_events:1},
  unknowns:["independent_provider_receipt_not_verified","hitpay_paid_order_not_reconciled","campaign_impact_not_causal"]};
const role={roleName:"bci_dev_lineage_writer",sessionRoleName:"bci_dev_lineage_writer",
  canLogin:true,bypassRls:false,superuser:false,canCreateRole:false,canCreateDb:false,
  canReplicate:false,inherits:false,parentRoles:0};
const posture={databaseName:"bros_intelligence_dev",forcedRls:true,lineageOnly:true,
  membershipFullSelectDenied:true,membershipColumnsAllowed:true,membershipMutationDenied:true,
  membershipForcedRls:true,lineagePolicyCount:5,boundLineagePolicyCount:4,
  lineagePolicyFingerprints:EXPECTED_LINEAGE_POLICY_FINGERPRINTS,evidenceDenied:true,
  schemaCreateDenied:true,dbCreateDenied:true,otherBciDenied:true,externalTablesDenied:true,
  definerExecDenied:true,allSchemaCreateDenied:true,sequenceAccessDenied:true};
const interpretation=interpretPersistedDemandMetaSignal(source);

function harness(fault){
  const state={nodes:new Map(fault==="missing-root"?[]:[[source.id,interpretation.evidence]]),
    edges:[],events:[],inserts:0,writeCommits:0,revoked:false};
  const pool={connect:async()=>{
    let nodes,edges,readOnly=false;
    return {release(){},query:async(sql,params=[])=>{
      if(sql.startsWith("BEGIN")){
        readOnly=sql.includes("READ ONLY");nodes=new Map(state.nodes);edges=[...state.edges];
        state.events.push(readOnly?"BEGIN:read":"BEGIN:write");return {rows:[]};
      }
      if(sql==="COMMIT"){
        state.events.push(readOnly?"COMMIT:read":"COMMIT:write");
        if(!readOnly){state.nodes=nodes;state.edges=edges;state.writeCommits++;
          if(fault==="revoked-after-commit")state.revoked=true;}
        return {rows:[]};
      }
      if(sql==="ROLLBACK"){state.events.push("ROLLBACK");return {rows:[]};}
      if(sql.includes('AS "roleName"'))return {rows:[fault==="impersonation"?{...role,sessionRoleName:"BROS"}:role]};
      if(sql.includes('AS "forcedRls"'))return {rows:[posture]};
      if(sql.includes("FROM bci_dev.tenant_memberships"))return {rows:[{activeCount:state.revoked?0:1}]};
      if(sql.includes("FROM bci_dev.lineage_nodes"))return {rows:[...nodes.values()].filter(n=>
        !sql.includes("AND id = ANY")||params[2].includes(n.id))};
      if(sql.includes("FROM bci_dev.lineage_edges"))return {rows:
        fault==="missing-committed-edge"&&readOnly&&state.writeCommits>0?[]:
          edges.filter(e=>params[2].includes(e.childId))};
      if(sql.startsWith("INSERT INTO")){
        if(readOnly)throw Error("test: READ ONLY write attempt");
        state.inserts++;
        if(sql.includes("lineage_nodes")){
          const [id,tenantId,product,stage,sourceSystem,sourceRecordKey,recordedAt,parentIds]=params;
          nodes.set(id,{id,tenantId,product,stage,sourceSystem,sourceRecordKey,recordedAt,parentIds,verification:"unverified"});
          return {rows:[{id}]};
        }
        edges.push({parentId:params[2],childId:params[3]});return {rows:[{childId:params[3]}]};
      }
      return {rows:[]};
    }};
  }};
  const deps={authenticate:async()=>fault==="bad-jwt"?null:{userId,authenticated:true},
    membershipsFor:async()=>state.revoked?[]:[{principalId:userId,tenantId:tenant,product:"demand",active:true}],
    readReceipt:async()=>fault==="source-changed-after-commit"&&state.writeCommits>0?
      {...source,metrics:{...source.metrics,spend_minor:12500}}:structuredClone(source),
    transaction:createPgLineageWriteTransaction(pool),
    readbackTransaction:createPgLineageReadTransaction(pool)};
  return {state,deps,save:createAuthenticatedDemandMetaSignal(deps)};
}

test("recorded source projects stable versioned non-causal signal and immutable evidence ancestry",()=>{
  const r=interpretPersistedDemandMetaSignal(structuredClone(source));
  assert.equal(r.sourceSha256,DEMAND_META_SIGNAL_SOURCE_SHA256);
  assert.equal(r.signal.id,interpretation.signal.id);
  assert.equal(r.signal.stage,"signal");assert.deepEqual(r.signal.parentIds,[source.id]);
  assert.equal(r.observed.spendMinor,12493);assert.equal(r.observed.inlineLinkClicks,63);
  assert.equal(r.observed.landingPageViews,33);assert.equal(r.observed.metaAttributedPurchases,1);
  assert.equal(r.verification,"unverified");assert.equal(r.providerAttested,false);
  assert.equal(r.verifiedPaidOrders,null);assert.equal(r.verifiedCpaMinor,null);
  assert.equal(r.causalLift,null);assert.equal(r.actionAuthorized,false);
  assert.equal(r.outcomeVerified,false);assert.equal(r.learningRecorded,false);
  assert.ok(Object.isFrozen(r.observed));assert.ok(Object.isFrozen(r.signal.parentIds));
});
test("changed window, scope, counts, source key, uncertainty or metric completeness cannot reuse V1",()=>{
  for(const patch of [
    {periodEnd:"2026-10-28T15:59:59.000Z"},
    {tenantId:"11111111-1111-4111-8111-111111111111"},
    {providerRecordKey:"demand:meta-read:sha256:"+"f".repeat(64)},
    {metrics:{...source.metrics,meta_attributed_purchases:0}},
    {metrics:{...source.metrics,landing_page_views:null}},
    {metrics:{...source.metrics,extra:99}},
    {unknowns:source.unknowns.slice(1)},
  ])assert.throws(()=>interpretPersistedDemandMetaSignal({...source,...patch}));
});
test("unknown-array accessors are rejected without evaluating them",()=>{
  let called=false;const unknowns=[...source.unknowns];
  Object.defineProperty(unknowns,"0",{enumerable:true,get(){called=true;throw Error("must not run");}});
  assert.throws(()=>interpretPersistedDemandMetaSignal({...source,unknowns}));assert.equal(called,false);
});
test("simulated append commits before separate read-only source/node/edge readback; replay inserts nothing",async()=>{
  const h=harness();const first=await h.save();
  assert.equal(first.status,"inserted");assert.equal(first.postCommitReadback,true);
  assert.equal(first.actionAuthorized,false);assert.equal(h.state.nodes.size,2);
  assert.equal(h.state.edges.length,1);assert.equal(h.state.inserts,2);
  const commit=h.state.events.indexOf("COMMIT:write");
  assert.ok(h.state.events.indexOf("BEGIN:read",commit+1)>commit);
  const replay=await h.save();assert.equal(replay.status,"replayed");
  assert.equal(replay.signalId,first.signalId);assert.equal(h.state.inserts,2);
  assert.equal(h.state.nodes.size,2);assert.equal(h.state.edges.length,1);
});
test("bad JWT, missing evidence root and admin SET ROLE cannot write or repair anything",async()=>{
  for(const fault of ["bad-jwt","missing-root","impersonation"]){
    const h=harness(fault);await assert.rejects(h.save(),/BCI_DEMAND_SIGNAL_DENIED/);
    assert.equal(h.state.inserts,0);assert.equal(h.state.writeCommits,0);
  }
});
test("post-commit edge loss, source drift and revocation remain unconfirmed despite committed insert",async()=>{
  for(const fault of ["missing-committed-edge","source-changed-after-commit","revoked-after-commit"]){
    const h=harness(fault);await assert.rejects(h.save(),/BCI_DEMAND_SIGNAL_DENIED/);
    assert.equal(h.state.writeCommits,1);assert.equal(h.state.nodes.size,2);
    assert.equal(h.state.inserts,2);
  }
});
test("readback-only operation rejects absent signal without inserting it",async()=>{
  const h=harness();const read=createAuthenticatedBciLineageReadback({...h.deps,
    transaction:h.deps.readbackTransaction});
  await assert.rejects(read({product:"demand",records:[interpretation.evidence,interpretation.signal]}));
  assert.equal(h.state.inserts,0);assert.equal(h.state.nodes.size,1);
});
