import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createContentReservationHttpHandler} from "../lib/bci/neon-content-reservation-http.ts";
import {usesNeonPreviewAuthentication} from "../lib/bci/neon-preview-route-policy.ts";
const origin="https://bci.example.test";
const path="/api/internal/neon-content-reservation";
const input={dispatchIntentId:"content-intent-1",approvalId:"content-approval-1",bindingSha256:"a".repeat(64)};
const reservationId="33333333-3333-4333-8333-333333333333";
const env={VERCEL_ENV:"preview",VERCEL_GIT_COMMIT_REF:"feat/neon-bci-dev-ledger-20261025",
  BCI_NEON_DEV_PRIVATE_READS:"enabled",BCI_NEON_DEV_CONTENT_RESERVATIONS:"enabled"};
const request=(patch={})=>new Request(origin+(patch.path??path),{method:patch.method??"POST",
  headers:{origin,authorization:"Bearer aaa.bbb.ccc","content-type":"application/json",...patch.headers},
  ...(patch.method==="GET"?{}:{body:patch.body??JSON.stringify(input)})});
function harness(delta={},result={status:"acquired",reservationId}){
  const calls=[];return {calls,handler:createContentReservationHttpHandler({env:()=>({...env,...delta}),
    execute:async(token,tuple)=>{calls.push({token,tuple});return result;}})};
}
test("CONTENT exact route reaches its own JWT boundary and no lookalike bypasses Supabase",()=>{
  assert.equal(usesNeonPreviewAuthentication(path),true);
  for(const p of [path+"/",path+"/admin",path+"s",path+"?tenant=other"])
    assert.equal(usesNeonPreviewAuthentication(p),false);
  const route=readFileSync(new URL("../app/api/internal/neon-content-reservation/route.ts",import.meta.url),"utf8");
  assert.match(route,/execute:reserveNeonDevContentPrivately/);
});
test("accepted reservation is nonexecuting and reports separately completed storage readback",async()=>{
  const h=harness();const r=await h.handler(request());
  assert.equal(r.status,200);assert.match(r.headers.get("cache-control"),/no-store/);
  assert.deepEqual(await r.json(),{status:"reserved",reservationId,postCommitReadback:true,
    providerSent:false,executionAllowed:false});
  assert.deepEqual(h.calls,[{token:"aaa.bbb.ccc",tuple:input}]);
});
test("repeat is reconciliation required and never returns another publish permit",async()=>{
  const h=harness({},{status:"already_reserved",reservationId:null});
  const r=await h.handler(request());assert.equal(r.status,200);
  assert.deepEqual(await r.json(),{status:"reconciliation_required",reservationId:null,
    postCommitReadback:true,providerSent:false,executionAllowed:false});
});
test("wrong branch/production/default-off flag and non-POST cannot call executor",async()=>{
  for(const delta of [{VERCEL_ENV:"production"},{VERCEL_GIT_COMMIT_REF:"main"},
    {BCI_NEON_DEV_PRIVATE_READS:"disabled"},{BCI_NEON_DEV_CONTENT_RESERVATIONS:undefined}]){
    const h=harness(delta);assert.equal((await h.handler(request())).status,404);assert.equal(h.calls.length,0);
  }
  const h=harness();assert.equal((await h.handler(request({method:"GET"}))).status,405);
  assert.equal(h.calls.length,0);
});
test("scope, query, cross-origin, token, malformed and oversized body reject before executor",async()=>{
  const h=harness();
  for(const patch of [{path:path+"?product=content"},{headers:{"x-tenant-id":"other"}},
    {headers:{origin:"https://evil.test"}},{headers:{"sec-fetch-site":"cross-site"}},
    {headers:{authorization:""}},{headers:{"content-type":"text/plain"}},
    {body:"[1,2]"},{body:"{"},{body:JSON.stringify({...input,tenantId:"other"})},
    {body:JSON.stringify({...input,action:"publish"})},{body:JSON.stringify({...input,bindingSha256:"z".repeat(64)})},
    {body:" ".repeat(2049)},{headers:{"content-length":"9999"}}]){
    assert.notEqual((await h.handler(request(patch))).status,200);
  }
  assert.equal(h.calls.length,0);
});
test("unconfirmed commit and malformed/privileged executor results never certify success",async()=>{
  for(const result of [{status:"acquired",reservationId:"bad"},
    {status:"already_reserved",reservationId},{status:"acquired",reservationId,executionAllowed:true}]){
    const h=harness({},result);assert.equal((await h.handler(request())).status,403);
  }
  const handler=createContentReservationHttpHandler({env:()=>env,
    execute:async()=>{throw Error("private credential details");}});
  const r=await handler(request());assert.equal(r.status,403);
  assert.doesNotMatch(JSON.stringify(await r.json()),/credential details/);
});
