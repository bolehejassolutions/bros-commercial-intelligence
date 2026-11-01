import test from "node:test";
import assert from "node:assert/strict";
import {createDemandCaseLinkHttpHandler} from "../lib/bci/neon-demand-case-link-http.ts";
const host="https://bci.example.test",path=host+"/api/internal/neon-demand-case";
const receiptId="4b1d0b40-371f-4c82-aaa9-d77580f88fac";
const caseId="33333333-3333-4333-8333-333333333333";
const env={VERCEL_ENV:"preview",VERCEL_GIT_COMMIT_REF:"feat/neon-bci-dev-ledger-20261025",
 BCI_NEON_DEV_PRIVATE_READS:"enabled",BCI_NEON_DEV_CASE_LINK_WRITES:"enabled"};
const req=(url=path,h={})=>new Request(url,{method:"POST",headers:{
 origin:host,authorization:"Bearer aaa.bbb.ccc",...h}});
const make=(delta={})=>{
 let calls=0;return {handler:createDemandCaseLinkHttpHandler({
 env:()=>({...env,...delta}),execute:async()=>{calls++;return {
 caseId,receiptId,status:"inserted",reviewOnly:true,providerAttested:false};}}),
 calls:()=>calls};
};
test("bounded signed POST returns review-only fixed receipt",async()=>{
 const h=make(),r=await h.handler(req());assert.equal(r.status,200);
 assert.match(r.headers.get("cache-control"),/no-store/);
 assert.deepEqual(await r.json(),{caseId,receiptId,status:"inserted",reviewOnly:true,providerAttested:false});
 assert.equal(h.calls(),1);
});
test("all branch/flag gates fail closed before executing",async()=>{
 for(const d of [{BCI_NEON_DEV_CASE_LINK_WRITES:undefined},{VERCEL_ENV:"production"},
 {VERCEL_GIT_COMMIT_REF:"main"},{BCI_NEON_DEV_PRIVATE_READS:"disabled"}]){
 const h=make(d);assert.equal((await h.handler(req())).status,404);assert.equal(h.calls(),0);}
});
test("rejects arbitrary receipt, identity hints, cross origin, invalid token and body",async()=>{
 const h=make();
 for(const r of [req(path+"?receiptId="+receiptId),req(path,{"x-tenant-id":"spoof"}),
 req(path,{origin:"https://evil.example"}),req(path,{"sec-fetch-site":"cross-site"}),
 req(path,{authorization:""}),req(path,{"content-type":"application/json"})]){
 assert.notEqual((await h.handler(r)).status,200);}
 assert.equal(h.calls(),0);
});
test("no secret-bearing error leakage",async()=>{
 const h=createDemandCaseLinkHttpHandler({env:()=>env,execute:async()=>{throw Error("secret");}});
 const r=await h(req());assert.equal(r.status,403);assert.doesNotMatch(JSON.stringify(await r.json()),/secret/);
});
