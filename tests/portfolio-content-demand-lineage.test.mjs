import test from "node:test";
import assert from "node:assert/strict";
import {
  prepareContentDemandLink,reviewContentDemandLandingLabels,
} from "../lib/portfolio/content-demand-lineage.mjs";
const tenant="11111111-1111-4111-8111-111111111111";
const input=()=>({
  schemaVersion:1,tenantId:tenant,contentPlanId:"content-plan-"+"a".repeat(64),
  creativeSha256:"b".repeat(64),channel:"facebook",campaignKey:"bros_sell_organic_v1",
  landingUrl:"https://bros.bolehejas.com/?ref=content",
});
const plan=()=>prepareContentDemandLink(input());

test("CONTENT plan creates deterministic DEMAND/Sell tracking, not approval or a sale",()=>{
  const a=plan(),b=plan();
  assert.deepEqual(a,b);
  assert.equal(a.status,"LINK_SPEC_NOT_PUBLISHED");
  assert.equal(a.tracking.utm_source,"facebook");
  assert.equal(a.tracking.utm_medium,"organic_social");
  assert.equal(a.tracking.utm_campaign,"bros_sell_organic_v1");
  assert.match(a.tracking.utm_content,/^bc_[a-f0-9]{24}$/);
  assert.ok(a.trackedLandingUrl.includes("ref=content"));
  assert.equal(a.executionAllowed,false);
  assert.equal(a.publicationVerified,false);
  assert.equal(a.landingReceiptVerified,false);
  assert.equal(a.verifiedPurchases,null);
  assert.equal(a.attributedRevenueMYR,null);
  assert.ok(!a.trackedLandingUrl.includes(tenant));
  assert.ok(!a.trackedLandingUrl.includes(a.contentPlanId));
});
test("Content/media/channel identity changes cannot silently reuse attribution labels",()=>{
  const a=plan(),p=input();
  p.creativeSha256="c".repeat(64);
  assert.notEqual(prepareContentDemandLink(p).tracking.utm_content,a.tracking.utm_content);
  p.creativeSha256=input().creativeSha256;
  p.channel="instagram";
  assert.notEqual(prepareContentDemandLink(p).tracking.utm_content,a.tracking.utm_content);
});
test("Matching observed labels are still unverified, with explicit next evidence action",()=>{
  const p=plan();
  const r=reviewContentDemandLandingLabels(p,p.trackedLandingUrl,tenant);
  assert.equal(r.status,"MATCHED_LABELS_UNATTESTED");
  assert.equal(r.serverReceiptVerified,false);
  assert.equal(r.verifiedPaidOrder,null);
  assert.equal(r.revenueMYR,null);
  assert.equal(r.executionAllowed,false);
});
test("Cross-tenant and tampered proposal are fail closed",()=>{
  const p=plan();
  assert.throws(()=>reviewContentDemandLandingLabels(p,p.trackedLandingUrl,
    "22222222-2222-4222-8222-222222222222"),/LINEAGE_INVALID/);
  assert.throws(()=>reviewContentDemandLandingLabels({...p,executionAllowed:true},
    p.trackedLandingUrl,tenant),/LINEAGE_INVALID/);
  assert.throws(()=>reviewContentDemandLandingLabels({...p,verifiedPurchases:1},
    p.trackedLandingUrl,tenant),/LINEAGE_INVALID/);
  assert.throws(()=>reviewContentDemandLandingLabels({...p,lineageKey:"forged"},
    p.trackedLandingUrl,tenant),/LINEAGE_INVALID/);
});
test("Duplicate/mismatched labels, conflicting campaigns, or changed path are rejected",()=>{
  const p=plan(),u=new URL(p.trackedLandingUrl);
  u.searchParams.append("utm_content",p.tracking.utm_content);
  assert.equal(reviewContentDemandLandingLabels(p,u.href,tenant).status,"LABEL_MISMATCH");
  u.searchParams.delete("utm_content");
  u.searchParams.set("utm_content",p.tracking.utm_content);
  u.searchParams.set("utm_campaign","some_other_campaign");
  assert.equal(reviewContentDemandLandingLabels(p,u.href,tenant).status,"LABEL_MISMATCH");
  u.searchParams.set("utm_campaign",p.tracking.utm_campaign);
  u.pathname="/another";
  assert.equal(reviewContentDemandLandingLabels(p,u.href,tenant).status,"LABEL_MISMATCH");
});
test("Unsafe/ambiguous destination and supplied UTM keys fail before link creation",()=>{
  for(const url of ["http://bros.bolehejas.com/",
    "https://user:pass@bros.bolehejas.com/",
    "https://bros.bolehejas.com/?utm_content=override",
    "https://localhost/","https://127.0.0.1/"]){
    assert.throws(()=>prepareContentDemandLink({...input(),landingUrl:url}),/LINEAGE_INVALID/);
  }
  assert.throws(()=>prepareContentDemandLink({...input(),campaignKey:"RM 100"}),/LINEAGE_INVALID/);
});
