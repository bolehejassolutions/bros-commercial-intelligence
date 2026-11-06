import test from "node:test";
import assert from "node:assert/strict";
import {createContentDemandLinkHttpHandler} from "../lib/portfolio/content-demand-link-http.ts";
import {usesNeonPreviewAuthentication} from "../lib/bci/neon-preview-route-policy.ts";

const tenant="11111111-1111-4111-8111-111111111111";
const jwt="eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.ABCD";
const endpoint="https://brosdemand.bolehejas.com/api/internal/portfolio-lineage";
const draft=()=>({
  contentPlanId:"content-plan-"+"a".repeat(64),
  creativeSha256:"b".repeat(64),channel:"facebook",
  campaignKey:"bros_sell_organic_v1",landingUrl:"https://bros.bolehejas.com/",
});
const req=(body=draft(),options={})=>new Request(endpoint,{
  method:"POST",
  headers:{"origin":options.origin??"https://brosdemand.bolehejas.com",
    "content-type":"application/json",
    ...(options.bearer===false?{}:{authorization:"Bearer "+jwt})},
  body:JSON.stringify(body),
});
const handler=(overrides={})=>createContentDemandLinkHttpHandler({
  enabled:()=>true,authorize:async()=>({tenantId:tenant,principalId:tenant}),...overrides,
});

test("portfolio route enters its existing Neon auth boundary",()=>{
  assert.equal(usesNeonPreviewAuthentication("/api/internal/portfolio-lineage"),true);
  assert.equal(usesNeonPreviewAuthentication("/api/internal/portfolio-lineage-other"),false);
});
test("authorized sole-tenant operator gets link, never permission or paid claims",async()=>{
  const response=await handler()(req());
  assert.equal(response.status,200);
  assert.match(response.headers.get("cache-control"),/no-store/);
  assert.equal(response.headers.get("vary"),"Authorization");
  const body=await response.json();
  assert.equal(body.status,"LINK_SPEC_NOT_PUBLISHED");
  assert.ok(body.trackedLandingUrl.startsWith("https://bros.bolehejas.com/"));
  assert.equal(body.contentApprovalVerified,false);
  assert.equal(body.providerSentVerified,false);
  assert.equal(body.paidOrderVerified,false);
  assert.equal(body.attributedRevenueMYR,null);
  assert.equal(body.executionAllowed,false);
  assert.ok(!JSON.stringify(body).includes(tenant));
  assert.ok(!JSON.stringify(body).includes(jwt));
});
test("reject disabled env, missing JWT, wrong origin and direct GET",async()=>{
  assert.equal((await handler({enabled:()=>false})(req())).status,404);
  assert.equal((await handler()(req(draft(),{bearer:false}))).status,401);
  assert.equal((await handler()(req(draft(),{origin:"https://other.example"}))).status,400);
  assert.equal((await handler()(new Request(endpoint,{method:"GET"}))).status,405);
});
test("never accept caller-selected tenant or untrusted extra authority",async()=>{
  assert.equal((await handler()(req({...draft(),tenantId:tenant}))).status,400);
  assert.equal((await handler()(req({...draft(),approved:true}))).status,400);
  assert.equal((await handler()(req({...draft(),landingUrl:"http://127.0.0.1/"}))).status,403);
});
test("authorization fails closed; does not produce a proposal",async()=>{
  const response=await handler({authorize:async()=>{throw Error("secret backend failure");}})(req());
  assert.equal(response.status,403);
  assert.ok(!(await response.text()).includes("secret backend failure"));
});
