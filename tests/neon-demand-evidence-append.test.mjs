import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  BciDemandEvidenceAppendDenied, createBciDemandMetaEvidenceAppender,
  createPgDemandEvidenceAppendTransaction,
} from "../lib/bci/neon-demand-evidence-append.ts";

const tenant="11111111-1111-4111-8111-111111111111";
const foreign="22222222-2222-4222-8222-222222222222";
const userId="33333333-3333-4333-8333-333333333333";
const recordId="44444444-4444-4444-8444-444444444444";
const fixed={accountId:"act_1997776120879476",campaignId:"120251158023300697",
  since:"2026-10-01",until:"2026-10-30"};
const role={roleName:"bci_dev_evidence_writer",sessionRoleName:"bci_dev_evidence_writer",
  canLogin:true,superuser:false,bypassRls:false,canCreateDb:false,
  canCreateRole:false,canReplicate:false,inherits:false,parentRoles:0};
const posture={databaseName:"bros_intelligence_dev",forcedRls:true,canInsert:true,
  canSelect:true,noEvidenceMutation:true,canReadMembership:true,
  noMembershipMutation:true,noSchemaCreate:true,noDbCreate:true,
  noApprovalAccess:true};
const grant={principalId:userId,tenantId:tenant,product:"demand",active:true};
const hash=v=>createHash("sha256").update(JSON.stringify(v)).digest("hex");
const candidateFor=(scope,at="2026-10-31T15:21:00Z")=>({
  candidateKey:"demand:meta-read:sha256:"+hash(["v1",scope.tenantId.toLowerCase(),
    scope.accountId,scope.campaignId,scope.since,scope.until,"NO_ROWS_NOT_ZERO",null]),
  stage:"UNATTESTED_READ_CANDIDATE_ONLY",reportStatus:"NO_ROWS_NOT_ZERO",
  windowStart:scope.since,windowEndInclusive:scope.until,collectedAt:at,
  metricsPresent:false,independentProviderReceiptRecorded:false,
  durableBciEvidenceRecorded:false,executionAllowed:false,
});
const deny=/BCI DEMAND evidence append denied/;

function harness(changes={}) {
  const calls=[];
  const state={stored:null, checks:0, observedScope:null};
  let at="2026-10-31T15:21:00Z";
  const membership=async () => {
    state.checks++;
    return changes.revoked && state.checks>=2 ? [] :
      changes.memberships ?? [grant];
  };
  const deps={
    fixedCampaign:changes.fixedCampaign ?? fixed,
    authenticate:changes.authenticate ?? (async()=>({userId,authenticated:true})),
    membershipsFor:changes.membershipsFor ?? membership,
    observeServerMeta:changes.observeServerMeta ?? (async scope => {
      state.observedScope=scope;
      const candidate=candidateFor(scope,at);
      if(changes.badCandidate) candidate.candidateKey="demand:meta-read:sha256:"+"f".repeat(64);
      return {candidate,report:null};
    }),
    transaction:changes.transaction ?? (async fn => fn(async(sql,params) => {
      calls.push({sql,params});
      if(sql.includes('AS "roleName"')) return {rows:[changes.role ?? role]};
      if(sql.includes('AS "forcedRls"')) return {rows:[changes.posture ?? posture]};
      if(sql.includes('FROM bci_dev.tenant_memberships')) return {
        rows:changes.sqlRevoked ? []:[{principalId:userId}]
      };
      if(sql.includes("INSERT INTO bci_dev.evidence")) {
        if(!state.stored) {
          state.stored={
            id:recordId,tenant_id:params[0],product:params[1],
            provider:params[2],provider_record_key:params[3],
            source_reference:params[4],observed_at:params[5],
            period_start:params[6],period_end:params[7],collected_at:params[8],
            completeness:params[9],metrics:JSON.parse(params[10]),
            facts:JSON.parse(params[11]),unknowns:JSON.parse(params[12]),
          };
          return {rows:[{id:recordId}]};
        }
        return {rows:[]};
      }
      if(sql.includes("FROM bci_dev.evidence WHERE")) {
        const row=changes.tamperExisting && state.stored ?
          {...state.stored,metrics:{spend_minor:999}} : state.stored;
        return {rows:row?[row]:[]};
      }
      return {rows:[]};
    })),
  };
  return {run:createBciDemandMetaEvidenceAppender(deps),calls,state,
    setCollectedAt:time=>{at=time;}};
}

test("default-unwired adapter inserts only a scoped unverified empty Meta observation",async()=>{
  const h=harness();
  const result=await h.run();
  assert.deepEqual(result,{status:"inserted",recordId,
    independentlyAttestedProvider:false,verifiedPaidOrders:null});
  assert.equal(h.state.observedScope.tenantId,tenant);
  assert.equal(h.state.observedScope.product,"demand");
  assert.equal(h.state.checks,2);
  assert.equal(h.state.stored.metrics.spend_minor,null);
  assert.equal(h.state.stored.metrics.meta_attributed_purchases,null);
  assert.equal(h.state.stored.completeness,"unverified");
  assert.ok(!h.state.stored.unknowns.includes("bci_durable_receipt_not_recorded"));
  assert.ok(h.state.stored.unknowns.includes("independent_provider_receipt_not_verified"));
  assert.ok(h.calls.some(x=>x.sql.includes("set_config('bci.tenant_id'") &&
    x.params[0]===tenant && x.params[1]==="demand"));
  assert.equal(h.calls.filter(x=>x.sql.includes("INSERT INTO bci_dev.evidence")).length,1);
  assert.ok(!h.calls.some(x=>/UPDATE bci_dev|DELETE FROM bci_dev/.test(x.sql)));
});

test("repeat candidate performs append-once then verified replay, never overwrite",async()=>{
  const h=harness();
  assert.equal((await h.run()).status,"inserted");
  h.setCollectedAt("2026-10-31T15:25:00Z");
  const replay=await h.run();
  assert.equal(replay.status,"replayed");
  assert.equal(h.state.stored.collected_at,"2026-10-31T15:21:00Z");
  assert.equal(h.calls.filter(x=>x.sql.includes("INSERT INTO bci_dev.evidence")).length,2);
});

test("conflicting immutable same-key row fails closed, does not mutate record",async()=>{
  const h=harness({tamperExisting:true});
  await assert.rejects(h.run(),deny);
  assert.equal(h.state.stored.metrics.spend_minor,null);
});

test("role/permission drift denies BEFORE SQL insert",async()=>{
  const wrong=[
    {role:{...role,sessionRoleName:"BROS"}},
    {role:{...role,canLogin:false}},
    {role:{...role,bypassRls:true}},
    {role:{...role,parentRoles:1}},
    {posture:{...posture,forcedRls:false}},
    {posture:{...posture,noEvidenceMutation:false}},
    {posture:{...posture,canReadMembership:false}},
    {posture:{...posture,noApprovalAccess:false}},
  ];
  for(const v of wrong) {
    const h=harness(v);
    await assert.rejects(h.run(),deny);
    assert.ok(!h.calls.some(x=>x.sql.includes("INSERT INTO bci_dev.evidence")));
  }
});

test("JWT/membership/cross-product/revocation defects block transaction",async()=>{
  const deniedCases=[
    {authenticate:async()=>null},
    {authenticate:async()=>({userId,authenticated:false})},
    {membershipsFor:async()=>[{...grant,tenantId:foreign},grant]},
    {membershipsFor:async()=>[{...grant,product:"content"}]},
    {membershipsFor:async()=>[{...grant,active:false}]},
    {revoked:true},
    {sqlRevoked:true},
    {badCandidate:true},
  ];
  for (const changes of deniedCases) {
    const h=harness(changes);
    await assert.rejects(h.run(),deny);
    assert.ok(!h.calls.some(x=>x.sql.includes("INSERT INTO bci_dev.evidence")));
  }
});

test("immutable campaign is pinned at creation; no user tenant/campaign argument",async()=>{
  const mutable={...fixed};
  const h=harness({fixedCampaign:mutable});
  mutable.campaignId="99999";
  assert.equal(h.run.length,0);
  await h.run();
  assert.equal(h.state.observedScope.campaignId,fixed.campaignId);
});

test("physical transaction commits once on success and rolls back/destroys on denial",async()=>{
  let calls=[],releases=[];
  const pool={connect:async()=>({query:async(sql,params=[])=>{
    calls.push([sql,params]);return {rows:[]};
  },release:destroy=>releases.push(destroy)})};
  const tx=createPgDemandEvidenceAppendTransaction(pool);
  assert.equal(await tx(async q=>{await q("SELECT $1",["ok"]);return "saved";}),"saved");
  assert.ok(calls.some(x=>x[0]==="COMMIT"));
  assert.deepEqual(releases,[false]);
  calls=[];releases=[];
  await assert.rejects(tx(async()=>{throw new Error("secret sql error");}),deny);
  assert.ok(calls.some(x=>x[0]==="ROLLBACK"));
  assert.ok(!calls.some(x=>x[0]==="COMMIT"));
  assert.deepEqual(releases,[true]);
});

test("constructor rejects unpinned or invalid dates/account scope",()=>{
  for(const c of [{...fixed,since:"2026-02-30"},{...fixed,until:"2026-09-30"},
    {...fixed,accountId:"admin"}, {...fixed,tenantId:tenant}]) {
    assert.throws(()=>harness({fixedCampaign:c}),BciDemandEvidenceAppendDenied);
  }
});
