import test from "node:test";
import assert from "node:assert/strict";
import { runNeonPreviewNegativeChecks } from "../lib/bci/neon-preview-negative-checks.ts";
const token = "eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJ0ZXN0In0.c2ln";
const control = () => new Response(JSON.stringify({ scope: "internal-development", evidence: [] }), {
 status: 200, headers: { "Cache-Control": "private, no-store", "Vary": "Authorization" },
});
test("both authenticated product controls precede seven bounded denial probes", async()=>{
 const calls=[];
 const mock=async (url,options)=>{
  calls.push({url,options});
  if (url.includes("&limit=1")) return control();
  const status=options.method==="POST"?405:url.endsWith("?product=content")&&!options.headers.Authorization?401:400;
  return new Response(JSON.stringify({error:status===405?"Method not allowed.":"BCI private evidence access denied."}),{status,headers:{"Cache-Control":"private, no-store","Vary":"Authorization"}});
 };
 const report=await runNeonPreviewNegativeChecks(token,mock);
 assert.equal(report.authenticatedControlsPassed,2);
 assert.equal(report.authenticatedControlsTotal,2);
 assert.equal(report.total,7);
 assert.equal(report.passed,7);
 assert.equal(calls.length,9);
 assert.equal(calls[0].url,"/api/internal/neon-evidence?product=content&limit=1");
 assert.equal(calls[1].url,"/api/internal/neon-evidence?product=demand&limit=1");
 assert.ok(calls.slice(0,2).every(c=>c.options.headers.Authorization===`Bearer ${token}`));
 assert.equal(calls[2].options.headers.Authorization,undefined);
 assert.equal(calls[3].options.headers.Authorization,`Bearer ${token}`);
 assert.equal(calls.filter(c=>c.options.method==="POST").length,1);
 assert.equal(JSON.stringify(report).includes(token),false);
 assert.ok(calls.every(c=>c.options.redirect==="error"&&c.options.cache==="no-store"));
});
test("wrong status, missing no-store, or leaked evidence fails the probe",async()=>{
 for(const variant of ["status","cache","leak"]){
  const mock=async url=>url.includes("&limit=1")?control():new Response(variant==="leak"?JSON.stringify({evidence:[{}]}):"{}",{
   status:variant==="status"?200:400,
   headers:{"Cache-Control":variant==="cache"?"public":"no-store","Vary":"Authorization"},
  });
  const report=await runNeonPreviewNegativeChecks(token,mock);
  assert.equal(report.authenticatedControlsPassed,2);
  assert.equal(report.passed,0);
 }
});
test("network failure is recorded as failure, without returning secrets",async()=>{
 const report=await runNeonPreviewNegativeChecks(token,async url=>{
  if (url.includes("&limit=1")) return control();
  throw new Error("secret-connection");
 });
 assert.equal(report.passed,0);
 assert.equal(JSON.stringify(report).includes("secret"),false);
});
test("rejects malformed tokens without issuing any request",async()=>{
 let called=0;
 await assert.rejects(runNeonPreviewNegativeChecks("bad",async()=>{called++;}),/Invalid preview token/);
 assert.equal(called,0);
});

test("invalid authenticated control fails closed before any denial probes",async()=>{
 for(const variant of ["status","cache","scope","missing","many","network"]){
  let called=0;
  const mock=async()=>{
   called++;
   if(variant==="network") throw new Error("secret-connection");
   const body=variant==="scope"?{scope:"other",evidence:[]}:variant==="missing"?{scope:"internal-development"}:variant==="many"?{scope:"internal-development",evidence:[{},{}]}:{scope:"internal-development",evidence:[]};
   return new Response(JSON.stringify(body),{status:variant==="status"?401:200,
    headers:{"Cache-Control":variant==="cache"?"public":"private, no-store","Vary":"Authorization"}});
  };
  await assert.rejects(runNeonPreviewNegativeChecks(token,mock),/Authenticated preview controls failed/);
  assert.equal(called,1);
 }
});

test("matching status and privacy headers cannot mask unexpected denial payloads",async()=>{
 for(const payload of [
  {error:"BCI private evidence access denied.",evidence:[{secret:"must-not-pass"}]},
  {error:"BCI private evidence access denied.",debug:"postgres://secret"},
  {error:"wrong denial"},
  {data:[{tenantId:"untrusted"}]},
  "not-json",
  "x".repeat(4096),
 ]){
  const mock=async (url,options)=>{
   if(url.includes("&limit=1")) return control();
   const status=options.method==="POST"?405:url.endsWith("?product=content")&&!options.headers.Authorization?401:400;
   return new Response(typeof payload==="string"?payload:JSON.stringify(payload),{
    status,headers:{"Cache-Control":"private, no-store","Vary":"Authorization"},
   });
  };
  const report=await runNeonPreviewNegativeChecks(token,mock);
  assert.equal(report.authenticatedControlsPassed,2);
  assert.equal(report.passed,0);
  assert.equal(JSON.stringify(report).includes("secret"),false);
 }
});
test("authenticated control rejects cross-product evidence even with HTTP 200",async()=>{
 let called=0;
 const mock=async (url)=>{
  called++;
  return new Response(JSON.stringify({scope:"internal-development",evidence:[{
   product:url.includes("product=content")?"demand":"content",
  }]}),{status:200,headers:{"Cache-Control":"private, no-store","Vary":"Authorization"}});
 };
 await assert.rejects(runNeonPreviewNegativeChecks(token,mock),/Authenticated preview controls failed/);
 assert.equal(called,1);
});
